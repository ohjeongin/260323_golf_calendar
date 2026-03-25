// Calendar Renderer — Week-Row Based with Spanning Event Bars

const TOUR_COLORS = ['#38bdf8', '#fb923c', '#f472b6', '#2dd4bf'];
const USER_COLOR_KEY = 'golf-tour-colors';

function getTournamentColor(tournament, allTournaments) {
    if (tournament.isCustom) return '#64748b';
    // Custom colors from settings
    let colors = TOUR_COLORS;
    try {
        const saved = JSON.parse(localStorage.getItem(USER_COLOR_KEY) || 'null');
        if (saved) colors = saved;
    } catch {}
    const idx = allTournaments.filter(t => !t.isCustom).findIndex(t => t.id === tournament.id);
    return colors[Math.max(idx, 0) % colors.length];
}

class Calendar {
    constructor(tournamentManager, onDayClick, onEventClick) {
        this.manager = tournamentManager;
        this.onDayClick = onDayClick;
        this.onEventClick = onEventClick;
        const now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth();
        this.selectedDate = null;
        this.grid = document.getElementById('calendarGrid');
        this.monthTitleEl = document.getElementById('monthTitle');
        this.yearTitleEl = document.getElementById('yearTitle');
    }

    render() {
        this._updateTitle();
        this._buildGrid();
    }

    prevYear() {
        this.currentYear--;
        this.selectedDate = null;
        this.render();
    }

    nextYear() {
        this.currentYear++;
        this.selectedDate = null;
        this.render();
    }

    prevMonth() {
        this.currentMonth--;
        if (this.currentMonth < 0) { this.currentMonth = 11; this.currentYear--; }
        this.selectedDate = null;
        this.render();
    }

    nextMonth() {
        this.currentMonth++;
        if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; }
        this.selectedDate = null;
        this.render();
    }

    goToToday() {
        const today = new Date();
        this.currentYear = today.getFullYear();
        this.currentMonth = today.getMonth();
        this.selectedDate = null;
        this.render();
    }

    get year() { return this.currentYear; }

    _updateTitle() {
        this.yearTitleEl.textContent = `${this.currentYear}년`;
        const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
        this.monthTitleEl.textContent = months[this.currentMonth];
    }

    _collectIntervals() {
        const intervals = [];
        const all = this.manager.tournaments;
        for (const t of all) {
            if (!this.manager._passesFilters(t)) continue;
            const color = getTournamentColor(t, all);
            const phases = [
                { type: 'registration', label: '신청', dates: t.dates.registration },
                { type: 'qualification', label: '예선', dates: t.dates.qualification },
                { type: 'finals', label: '본선', dates: t.dates.finals },
                { type: 'practice', label: '공식연습', dates: t.dates.practice }
            ];
            for (const ph of phases) {
                if (!ph.dates || !this.manager.filters.types.has(ph.type)) continue;
                intervals.push({
                    tournament: t, type: ph.type, label: ph.label, color,
                    startDate: ph.dates.start, endDate: ph.dates.end,
                    name: this._shortName(t.name)
                });
            }
        }
        return intervals;
    }

    _buildGrid() {
        this.grid.innerHTML = '';
        const firstDay = new Date(this.currentYear, this.currentMonth, 1).getDay();
        const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        const daysInPrev = new Date(this.currentYear, this.currentMonth, 0).getDate();
        const today = new Date();
        const todayStr = this._fmt(today.getFullYear(), today.getMonth(), today.getDate());

        const days = [];
        // trailing previous month
        for (let i = firstDay - 1; i >= 0; i--) {
            const pm = this.currentMonth === 0 ? 11 : this.currentMonth - 1;
            const py = this.currentMonth === 0 ? this.currentYear - 1 : this.currentYear;
            days.push({ day: daysInPrev - i, dateStr: this._fmt(py, pm, daysInPrev - i), otherMonth: true });
        }
        // current month
        for (let d = 1; d <= daysInMonth; d++) {
            days.push({ day: d, dateStr: this._fmt(this.currentYear, this.currentMonth, d), otherMonth: false });
        }
        // leading next month
        const rem = days.length % 7 === 0 ? 0 : 7 - (days.length % 7);
        for (let d = 1; d <= rem; d++) {
            const nm = this.currentMonth === 11 ? 0 : this.currentMonth + 1;
            const ny = this.currentMonth === 11 ? this.currentYear + 1 : this.currentYear;
            days.push({ day: d, dateStr: this._fmt(ny, nm, d), otherMonth: true });
        }

        const intervals = this._collectIntervals();
        const weekCount = days.length / 7;
        for (let w = 0; w < weekCount; w++) {
            this._renderWeek(days.slice(w * 7, w * 7 + 7), intervals, todayStr);
        }
    }

    _renderWeek(weekDays, allIntervals, todayStr) {
        const weekStart = weekDays[0].dateStr;
        const weekEnd = weekDays[6].dateStr;
        const weekIntervals = allIntervals.filter(iv => iv.startDate <= weekEnd && iv.endDate >= weekStart);

        // Assign lanes (greedy)
        const lanes = [];
        const sorted = [...weekIntervals].sort((a, b) => {
            if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
            return a.endDate > b.endDate ? -1 : 1;
        });

        for (const iv of sorted) {
            const startCol = weekDays.findIndex(d => d.dateStr >= iv.startDate);
            let endCol = -1;
            for (let i = 6; i >= 0; i--) {
                if (weekDays[i].dateStr <= iv.endDate) { endCol = i; break; }
            }
            if (startCol === -1 || endCol === -1) continue;

            let lane = 0;
            while (true) {
                if (!lanes[lane]) lanes[lane] = [];
                const conflict = lanes[lane].some(p => !(endCol < p.startCol || startCol > p.endCol));
                if (!conflict) { lanes[lane].push({ ...iv, startCol, endCol }); break; }
                lane++;
            }
        }

        const weekEl = document.createElement('div');
        weekEl.className = 'calendar-week';

        // Day header row
        const headRow = document.createElement('div');
        headRow.className = 'calendar-week-header';
        weekDays.forEach((d, i) => {
            const cell = document.createElement('div');
            cell.className = 'calendar-day-header';
            if (d.otherMonth) cell.classList.add('other-month');
            if (d.dateStr === todayStr) cell.classList.add('today');
            if (d.dateStr === this.selectedDate) cell.classList.add('selected');

            const num = document.createElement('div');
            num.className = 'day-num';
            num.textContent = d.day;
            // Sun=0, Sat=6 coloring handled via CSS nth-child
            cell.appendChild(num);

            cell.addEventListener('click', () => {
                if (d.otherMonth) return;
                this.grid.querySelectorAll('.calendar-day-header.selected').forEach(el => el.classList.remove('selected'));
                cell.classList.add('selected');
                this.selectedDate = d.dateStr;
                this.onDayClick(d.dateStr, this.manager.getEventsForDate(d.dateStr));
            });
            headRow.appendChild(cell);
        });
        weekEl.appendChild(headRow);

        // Event bar rows
        const maxLanes = Math.min(lanes.length, 4);
        for (let l = 0; l < maxLanes; l++) {
            const row = document.createElement('div');
            row.className = 'calendar-week-events';

            const placements = (lanes[l] || []).slice().sort((a, b) => a.startCol - b.startCol);
            let col = 0;
            for (const p of placements) {
                if (p.startCol > col) {
                    const sp = document.createElement('div');
                    sp.className = 'event-spacer';
                    sp.style.gridColumn = `${col + 1} / ${p.startCol + 1}`;
                    row.appendChild(sp);
                }
                const bar = document.createElement('div');
                bar.className = `event-bar ${p.type}`;
                bar.style.gridColumn = `${p.startCol + 1} / ${p.endCol + 2}`;
                bar.style.backgroundColor = p.color;
                const isReg = this.manager.isRegistered(p.tournament.id);
                const displayLabel = this._makeLabel(p.label, p.tournament.name);
                bar.textContent = `${isReg ? '✅ ' : ''}${displayLabel} ${p.name}`;
                bar.title = `${p.tournament.name} — ${p.label} ${this._fmtShort(p.startDate)}~${this._fmtShort(p.endDate)}`;
                bar.addEventListener('click', e => {
                    e.stopPropagation();
                    if (this.onEventClick) this.onEventClick(p.tournament);
                });
                row.appendChild(bar);
                col = p.endCol + 1;
            }
            weekEl.appendChild(row);
        }

        if (lanes.length > 4) {
            const ov = document.createElement('div');
            ov.className = 'calendar-week-overflow';
            ov.textContent = `+${lanes.length - 4}개 더`;
            weekEl.appendChild(ov);
        }

        this.grid.appendChild(weekEl);
    }

    _shortName(name) {
        // 단계 정보 제거 후 대회명만 축약
        let s = name.replace(/\s*\((?:1차\s*)?(?:최종\s*)?예선\)$/, '').replace(/^\d{4}\s*/, '').replace(/^제?\d+회\s*/, '');
        return s.length > 12 ? s.substring(0, 11) + '…' : s;
    }

    _makeLabel(phase, name) {
        // phase: 신청/예선/본선/연습
        // name: "임실치즈배 (예선)", "한국오픈 (1차 예선)", "임실치즈배" (본선)
        const stageMatch = name.match(/\((1차\s*예선|최종\s*예선|예선)\)$/);
        const stage = stageMatch ? stageMatch[1].replace(/\s/g, '') : '본선';
        // [신청-예선], [본선-1차예선], [신청-본선] 등
        return `[${phase}-${stage}]`;
    }

    _fmtShort(dateStr) {
        const d = new Date(dateStr);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }

    _fmt(y, m, d) {
        return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
}

export default Calendar;
export { TOUR_COLORS, getTournamentColor };
