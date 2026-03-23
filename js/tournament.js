// Tournament Data Manager
// 대회 데이터 로드, 필터링, 쿼리 관리

const EXCLUDED_KEYWORDS = ['시니어', 'senior', '그랜드시니어', '미드시니어', '초등', '어린이', '유소년'];

class TournamentManager {
    constructor() {
        this.tournaments = [];
        this.filters = {
            associations: new Set(['KGA', 'KJGA', '충남', '개인일정']),
            types: new Set(['registration', 'qualification', 'finals', 'practice']),
            eventtypes: new Set(['student', 'amateur', 'open'])
        };
        this.registeredTournaments = this._loadRegistered();
        this.persistentTournaments = this._loadPersistentTournaments();
        this.customEvents = this._loadCustomEvents();
        this.lastUpdated = null;
    }

    async load(forceRefresh = false) {
        try {
            const url = forceRefresh
                ? `./data/tournaments.json?t=${Date.now()}`
                : './data/tournaments.json';
            const response = await fetch(url);

            if (!response.ok) throw new Error(`HTTP error ${response.status}`);

            const data = await response.json();
            this.lastUpdated = new Date();

            const official = data.filter(t => {
                const name = t.name.toLowerCase();
                return !EXCLUDED_KEYWORDS.some(kw => name.includes(kw.toLowerCase()));
            });

            this.tournaments = [...official, ...this.persistentTournaments, ...this.customEvents];
            return this.tournaments;
        } catch (error) {
            console.error('Failed to load tournament data:', error);
            this.tournaments = [...this.persistentTournaments, ...this.customEvents];
            return this.tournaments;
        }
    }

    // 특정 날짜의 이벤트 반환 (현재 필터 적용)
    getEventsForDate(dateStr) {
        const events = [];
        for (const t of this.tournaments) {
            if (!this._passesFilters(t)) continue;
            const { dates } = t;
            if (this.filters.types.has('registration') && dates.registration) {
                if (this._inRange(dateStr, dates.registration)) events.push({ tournament: t, type: 'registration', label: '신청' });
            }
            if (this.filters.types.has('qualification') && dates.qualification) {
                if (this._inRange(dateStr, dates.qualification)) events.push({ tournament: t, type: 'qualification', label: '예선' });
            }
            if (this.filters.types.has('finals') && dates.finals) {
                if (this._inRange(dateStr, dates.finals)) events.push({ tournament: t, type: 'finals', label: '본선' });
            }
            if (this.filters.types.has('practice') && dates.practice) {
                if (this._inRange(dateStr, dates.practice)) events.push({ tournament: t, type: 'practice', label: '연습' });
            }
        }
        return events;
    }

    // 특정 연월의 모든 이벤트 반환
    getEventsForMonth(year, month) {
        const events = {};
        const days = new Date(year, month + 1, 0).getDate();
        for (let d = 1; d <= days; d++) {
            const dateStr = this._fmt(year, month, d);
            const dayEvents = this.getEventsForDate(dateStr);
            if (dayEvents.length > 0) events[dateStr] = dayEvents;
        }
        return events;
    }

    // 다가오는 일정 (특정 연도 기준, 오늘 이후)
    getUpcoming(limit = 6, filterYear = null) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const upcoming = [];

        for (const t of this.tournaments) {
            if (!this._passesFilters(t)) continue;
            const phases = [
                { type: 'registration', label: '신청', dates: t.dates.registration },
                { type: 'qualification', label: '예선', dates: t.dates.qualification },
                { type: 'finals', label: '본선', dates: t.dates.finals },
                { type: 'practice', label: '연습', dates: t.dates.practice }
            ];
            for (const phase of phases) {
                if (!phase.dates || !this.filters.types.has(phase.type)) continue;
                const start = new Date(phase.dates.start);
                if (start < today) continue;
                // 연도 필터
                if (filterYear && start.getFullYear() !== filterYear) continue;
                upcoming.push({
                    tournament: t,
                    type: phase.type,
                    label: phase.label,
                    startDate: phase.dates.start,
                    endDate: phase.dates.end,
                    daysUntil: Math.ceil((start - today) / 86400000)
                });
            }
        }

        upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
        return upcoming.slice(0, limit);
    }

    // 필터 토글 (association / type / eventtype)
    toggleFilter(category, value) {
        let set;
        if (category === 'association') set = this.filters.associations;
        else if (category === 'type') set = this.filters.types;
        else if (category === 'eventtype') set = this.filters.eventtypes;
        else return false;

        if (set.has(value)) set.delete(value);
        else set.add(value);
        return set.has(value);
    }

    toggleRegistered(id) {
        if (this.registeredTournaments.has(id)) this.registeredTournaments.delete(id);
        else this.registeredTournaments.add(id);
        this._saveRegistered();
        return this.registeredTournaments.has(id);
    }

    isRegistered(id) { return this.registeredTournaments.has(id); }

    getTournamentById(id) { return this.tournaments.find(t => t.id === id); }

    // 개인 일정 추가
    addCustomEvent(data) {
        const ev = {
            id: `custom-${Date.now()}`,
            name: data.name,
            association: '개인일정',
            type: 'custom',
            year: new Date(data.dates.finals?.start || data.dates.registration?.start || new Date()).getFullYear(),
            verified: true,
            dates: data.dates,
            venue: data.venue || '개인',
            categories: ['개인'],
            url: '',
            isCustom: true
        };
        this.customEvents.push(ev);
        this._saveCustomEvents();
        this.tournaments.push(ev);
        return ev;
    }

    deleteCustomEvent(id) {
        this.customEvents = this.customEvents.filter(e => e.id !== id);
        this._saveCustomEvents();
        this.tournaments = this.tournaments.filter(e => e.id !== id);
    }

    // 관리자용: 영구 대회 관리
    addPersistentTournament(t) {
        if (!t.id) t.id = `admin-${Date.now()}`;
        this.persistentTournaments.push(t);
        this._savePersistentTournaments();
        this.tournaments.push(t);
    }

    updatePersistentTournament(id, data) {
        const i = this.persistentTournaments.findIndex(t => t.id === id);
        if (i !== -1) {
            this.persistentTournaments[i] = { ...this.persistentTournaments[i], ...data };
            this._savePersistentTournaments();
            const j = this.tournaments.findIndex(t => t.id === id);
            if (j !== -1) this.tournaments[j] = this.persistentTournaments[i];
        }
    }

    deletePersistentTournament(id) {
        this.persistentTournaments = this.persistentTournaments.filter(t => t.id !== id);
        this._savePersistentTournaments();
        this.tournaments = this.tournaments.filter(t => t.id !== id);
    }

    // --- Private ---
    _passesFilters(t) {
        if (!this.filters.associations.has(t.association)) return false;
        // 유형 필터 (개인일정은 항상 통과)
        if (t.association !== '개인일정' && !t.isCustom) {
            const ttype = t.type || 'amateur';
            if (ttype === 'student' && !this.filters.eventtypes.has('student')) return false;
            if (ttype === 'amateur' && !this.filters.eventtypes.has('amateur')) return false;
            if (ttype === 'open' && !this.filters.eventtypes.has('open')) return false;
        }
        return true;
    }

    _inRange(dateStr, range) {
        return dateStr >= range.start && dateStr <= range.end;
    }

    _fmt(y, m, d) {
        return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    _loadRegistered() {
        try { return new Set(JSON.parse(localStorage.getItem('golf-registered') || '[]')); }
        catch { return new Set(); }
    }
    _saveRegistered() {
        localStorage.setItem('golf-registered', JSON.stringify([...this.registeredTournaments]));
    }
    _loadCustomEvents() {
        try { return JSON.parse(localStorage.getItem('golf-custom-events') || '[]'); }
        catch { return []; }
    }
    _saveCustomEvents() {
        localStorage.setItem('golf-custom-events', JSON.stringify(this.customEvents));
    }
    _loadPersistentTournaments() {
        try { return JSON.parse(localStorage.getItem('golf-persistent-tournaments') || '[]'); }
        catch { return []; }
    }
    _savePersistentTournaments() {
        localStorage.setItem('golf-persistent-tournaments', JSON.stringify(this.persistentTournaments));
    }
}

export default TournamentManager;
