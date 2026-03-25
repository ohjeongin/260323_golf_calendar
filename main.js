// Golf Calendar — Main Application Entry Point

import TournamentManager from './js/tournament.js';
import Calendar, { PHASE_COLORS } from './js/calendar.js';
import Modal from './js/modal.js';
import NotificationManager, { showToast } from './js/notification.js';

class App {
    constructor() {
        this.tm = new TournamentManager();
        this.nm = new NotificationManager(this.tm);
        this.calendar = null;
        this.modal = null;
    }

    async init() {
        try {
            await this.tm.load();
        } catch (e) {
            console.error('Load failed:', e);
        }

        this.nm.initializeDefaults();
        this.nm.requestPermission();

        this.calendar = new Calendar(
            this.tm,
            (dateStr, events) => this._showDayDetail(dateStr, events),
            (tournament) => this.modal.show(tournament)
        );

        this.modal = new Modal(this.tm, this.nm, () => this._refresh());

        this.calendar.render();
        this._renderUpcoming();
        this._updateBadge();
        this._updateTimeDisplay();
        this._bindEvents();
        this.nm.startChecking();

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        }
    }

    _bindEvents() {
        // 새로고침
        const updateBtn = document.getElementById('updateInfo');
        updateBtn.addEventListener('click', async () => {
            if (updateBtn.classList.contains('spinning')) return;
            updateBtn.classList.add('spinning');
            document.getElementById('updateTime').textContent = '업데이트 중...';
            try {
                await this.tm.load(true);
                this.nm.initializeDefaults();
            } catch {}
            this.calendar.render();
            this._renderUpcoming();
            this._updateBadge();
            setTimeout(() => {
                updateBtn.classList.remove('spinning');
                this._updateTimeDisplay();
                const changes = this.tm.lastChanges || [];
                if (changes.length > 0) {
                    showToast(`🔔 ${changes.length}건 변경 감지! 📋 아이콘에서 확인하세요.`, 'success');
                    this._updateBadge();
                    this._updateChangeLogBadge();
                } else {
                    showToast('최신 상태입니다. 변경사항 없음.', 'success');
                }
            }, 600);
        });

        // 변경 내역 모달
        document.getElementById('btnChangeLog').addEventListener('click', () => {
            this._renderChangeLogModal();
            document.getElementById('changeLogModalOverlay').classList.add('active');
        });
        document.getElementById('changeLogClose').addEventListener('click', () => {
            document.getElementById('changeLogModalOverlay').classList.remove('active');
        });
        document.getElementById('changeLogModalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'changeLogModalOverlay') e.target.classList.remove('active');
        });

        // 년도 네비게이션
        document.getElementById('prevYear').addEventListener('click', () => {
            this.calendar.prevYear();
            this._hideDayDetail();
            this._renderUpcoming();
        });
        document.getElementById('nextYear').addEventListener('click', () => {
            this.calendar.nextYear();
            this._hideDayDetail();
            this._renderUpcoming();
        });

        // 월 네비게이션
        document.getElementById('prevMonth').addEventListener('click', () => {
            this.calendar.prevMonth();
            this._hideDayDetail();
            this._renderUpcoming();
        });
        document.getElementById('nextMonth').addEventListener('click', () => {
            this.calendar.nextMonth();
            this._hideDayDetail();
            this._renderUpcoming();
        });
        document.getElementById('todayBtn').addEventListener('click', () => {
            this.calendar.goToToday();
            this._hideDayDetail();
            this._renderUpcoming();
        });

        // 키보드 단축키
        document.addEventListener('keydown', e => {
            if (document.getElementById('modalOverlay').classList.contains('active')) return;
            if (e.key === 'ArrowLeft') { this.calendar.prevMonth(); this._hideDayDetail(); this._renderUpcoming(); }
            if (e.key === 'ArrowRight') { this.calendar.nextMonth(); this._hideDayDetail(); this._renderUpcoming(); }
        });

        // 필터 버튼
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const active = this.tm.toggleFilter(btn.dataset.filter, btn.dataset.value);
                btn.classList.toggle('active', active);
                this._refresh();
            });
        });

        // Day detail 닫기
        document.getElementById('dayDetailClose').addEventListener('click', () => this._hideDayDetail());

        // 알림 패널
        document.getElementById('btnNotification').addEventListener('click', () => this._togglePanel('notifPanel'));
        document.getElementById('notifPanelClose').addEventListener('click', () => document.getElementById('notifPanel').classList.remove('active'));

        // 데이터 소스 패널
        document.getElementById('btnSources').addEventListener('click', () => this._togglePanel('sourcesPanel'));
        document.getElementById('sourcesPanelClose').addEventListener('click', () => document.getElementById('sourcesPanel').classList.remove('active'));

        // 설정 모달
        const settingsOverlay = document.getElementById('settingsModalOverlay');
        document.getElementById('btnSettings').addEventListener('click', () => settingsOverlay.classList.add('active'));
        document.getElementById('settingsClose').addEventListener('click', () => settingsOverlay.classList.remove('active'));
        settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) settingsOverlay.classList.remove('active'); });

        // 설정 탭
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
            });
        });

        // 색상 저장
        document.getElementById('btnSaveTheme')?.addEventListener('click', () => {
            const colors = [
                document.getElementById('colorTour0').value,
                document.getElementById('colorTour1').value,
                document.getElementById('colorTour2').value,
                document.getElementById('colorTour3').value
            ];
            localStorage.setItem('golf-tour-colors', JSON.stringify(colors));
            this.calendar.render();
            showToast('색상이 저장되었습니다.', 'success');
        });

        // 데이터 관리
        document.getElementById('btnExportJson')?.addEventListener('click', () => {
            const data = JSON.stringify(this.tm.tournaments, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `golf-tournaments-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            showToast('데이터를 내보냈습니다.', 'success');
        });

        document.getElementById('btnResetAll')?.addEventListener('click', () => {
            if (!confirm('모든 신청 표시, 알림 설정, 개인 일정을 초기화하시겠습니까?')) return;
            localStorage.removeItem('golf-registered');
            localStorage.removeItem('golf-notif-settings');
            localStorage.removeItem('golf-notif-log');
            localStorage.removeItem('golf-custom-events');
            localStorage.removeItem('golf-persistent-tournaments');
            showToast('초기화되었습니다.', 'success');
            setTimeout(() => location.reload(), 1000);
        });

        // 대회 관리 탭
        document.getElementById('btnAdminAddTour')?.addEventListener('click', () => {
            document.getElementById('customEventModalOverlay').classList.add('active');
        });

        document.getElementById('adminTourSearch')?.addEventListener('input', e => {
            this._renderAdminList(e.target.value);
        });

        // 설정 모달이 열릴 때 대회 관리 목록 렌더링
        document.querySelectorAll('.settings-tab').forEach(tab => {
            if (tab.dataset.tab === 'tournaments') {
                tab.addEventListener('click', () => this._renderAdminList(''));
            }
        });

        // 개인 일정 추가 모달
        const customOverlay = document.getElementById('customEventModalOverlay');
        const customClose = document.getElementById('customEventClose');
        const customForm = document.getElementById('customEventForm');

        document.getElementById('btnAddCustom').addEventListener('click', () => {
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('ceStart').value = today;
            document.getElementById('ceEnd').value = today;
            customOverlay.classList.add('active');
        });

        customClose.addEventListener('click', () => this._closeCustomModal());
        customOverlay.addEventListener('click', e => { if (e.target === customOverlay) this._closeCustomModal(); });

        customForm.addEventListener('submit', e => {
            e.preventDefault();
            const name = document.getElementById('ceName').value.trim();
            const type = document.getElementById('ceType').value;
            const start = document.getElementById('ceStart').value;
            const end = document.getElementById('ceEnd').value;
            const venue = document.getElementById('ceVenue').value.trim();

            if (!name || !start || !end) return;
            if (start > end) { showToast('시작일이 종료일보다 늦을 수 없습니다.', 'warning'); return; }

            const dates = { registration: null, qualification: null, finals: null, practice: null };
            dates[type] = { start, end };

            this.tm.addCustomEvent({ name, dates, venue });
            showToast('일정이 추가되었습니다.', 'success');
            this.calendar.render();
            this._renderUpcoming();
            this._closeCustomModal();
        });
    }

    _closeCustomModal() {
        document.getElementById('customEventModalOverlay').classList.remove('active');
        document.getElementById('customEventForm').reset();
    }

    _togglePanel(panelId) {
        const panel = document.getElementById(panelId);
        const isActive = panel.classList.contains('active');
        // 다른 패널 닫기
        document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('active'));
        if (!isActive) {
            panel.classList.add('active');
            if (panelId === 'notifPanel') {
                this._renderNotifPanel();
            }
        }
    }

    _renderNotifPanel() {
        const content = document.getElementById('notifPanelContent');
        content.innerHTML = this.nm.buildPanelContent();

        content.querySelectorAll('.notification-item').forEach(item => {
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => {
                const t = this.tm.getTournamentById(item.dataset.tournamentId);
                if (t) {
                    document.getElementById('notifPanel').classList.remove('active');
                    this.modal.show(t);
                }
            });
        });

        document.getElementById('btnTestNotif')?.addEventListener('click', e => {
            e.stopPropagation();
            this.nm.sendImmediateNotification('⛳ 알림 테스트 성공!', '이렇게 대회 신청 알림이 도착합니다!');
            showToast('테스트 알림을 보냈습니다.', 'success');
        });
    }

    _renderAdminList(query = '') {
        const list = document.getElementById('adminTourList');
        if (!list) return;
        const filtered = this.tm.tournaments.filter(t =>
            !query || t.name.toLowerCase().includes(query.toLowerCase())
        );
        if (filtered.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-tertiary);font-size:12px;">검색 결과가 없습니다.</div>';
            return;
        }
        list.innerHTML = filtered.map(t => `
            <div class="admin-tour-item">
                <span class="admin-tour-item-name">${t.name}</span>
                <div class="admin-tour-actions">
                    ${t.isCustom || t.association === '개인일정'
                        ? `<button class="btn-admin-del" data-id="${t.id}">삭제</button>`
                        : ''
                    }
                </div>
            </div>
        `).join('');

        list.querySelectorAll('.btn-admin-del').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = this.tm.getTournamentById(btn.dataset.id);
                if (!t) return;
                if (confirm(`"${t.name}"을(를) 삭제하시겠습니까?`)) {
                    if (t.isCustom || t.association === '개인일정') {
                        this.tm.deleteCustomEvent(t.id);
                    } else {
                        this.tm.deletePersistentTournament(t.id);
                    }
                    this._refresh();
                    this._renderAdminList(query);
                    showToast('삭제되었습니다.', 'success');
                }
            });
        });
    }

    _showDayDetail(dateStr, events) {
        const detail = document.getElementById('dayDetail');
        const titleEl = document.getElementById('dayDetailTitle');
        const contentEl = document.getElementById('dayDetailContent');

        const d = new Date(dateStr);
        const days = ['일','월','화','수','목','금','토'];
        titleEl.textContent = `📋 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;

        if (events.length === 0) {
            contentEl.innerHTML = '<div class="day-detail-empty">이 날짜에 등록된 대회가 없습니다.</div>';
        } else {
            contentEl.innerHTML = events.map(ev => this._buildCard(ev)).join('');
            this._bindCardEvents(contentEl);
        }

        detail.classList.remove('hidden');
        detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    _hideDayDetail() {
        document.getElementById('dayDetail').classList.add('hidden');
    }

    _buildCard(event) {
        const t = event.tournament;
        const assocClass = t.association === 'KGA' ? 'kga' : t.association === 'KJGA' ? 'kjga' : t.association === '충남' ? 'chungnam' : 'custom';
        const typeClass = t.type === 'student' ? 'student' : t.type === 'open' ? 'open' : 'amateur';
        const typeLabel = t.type === 'student' ? '학생' : t.type === 'open' ? '오픈' : t.isCustom ? '개인' : '아마추어';
        const isReg = this.tm.isRegistered(t.id);
        const color = t.isCustom ? PHASE_COLORS.custom : PHASE_COLORS.finals;

        const tags = [];
        if (t.dates.registration) tags.push(`<span class="date-tag registration">신청 ${this._fmtShort(t.dates.registration.start)}~${this._fmtShort(t.dates.registration.end)}</span>`);
        if (t.dates.qualification) tags.push(`<span class="date-tag qualification">예선 ${this._fmtShort(t.dates.qualification.start)}~${this._fmtShort(t.dates.qualification.end)}</span>`);
        if (t.dates.finals) tags.push(`<span class="date-tag finals">본선 ${this._fmtShort(t.dates.finals.start)}~${this._fmtShort(t.dates.finals.end)}</span>`);

        const unverified = (!t.verified && !t.isCustom) ? `<span class="unverified-badge">미확인</span>` : '';

        return `
        <div class="tournament-card" data-tournament-id="${t.id}" style="border-left-color:${color}">
            <div class="tournament-card-header">
                <span class="tournament-card-title">${t.name}</span>
                <div class="tournament-badges">
                    <span class="badge-assoc ${assocClass}">${t.association}</span>
                    <span class="badge-type ${typeClass}">${typeLabel}</span>
                </div>
            </div>
            <div class="tournament-card-dates">${tags.join('')}</div>
            <div class="tournament-card-footer">
                <span class="tournament-venue">📍 ${t.venue}</span>
                ${unverified}
                <button class="btn-register ${isReg ? 'checked' : ''}" data-tournament-id="${t.id}">
                    ${isReg ? '✅ 신청완료' : '☐ 신청'}
                </button>
            </div>
        </div>`;
    }

    _bindCardEvents(container) {
        container.querySelectorAll('.tournament-card').forEach(card => {
            card.addEventListener('click', e => {
                if (e.target.closest('.btn-register')) return;
                const t = this.tm.getTournamentById(card.dataset.tournamentId);
                if (t) this.modal.show(t);
            });
        });
        container.querySelectorAll('.btn-register').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const id = btn.dataset.tournamentId;
                const now = this.tm.toggleRegistered(id);
                btn.classList.toggle('checked', now);
                btn.textContent = now ? '✅ 신청완료' : '☐ 신청';
                this.calendar.render();
                showToast(now ? '✅ 신청 완료로 표시했습니다' : '☐ 신청 표시를 해제했습니다');
            });
        });
    }

    _renderUpcoming() {
        const list = document.getElementById('upcomingList');
        const badge = document.getElementById('upcomingYearBadge');
        const year = this.calendar ? this.calendar.year : new Date().getFullYear();

        if (badge) badge.textContent = `${year}년`;

        const upcoming = this.tm.getUpcoming(6, year);

        if (upcoming.length === 0) {
            list.innerHTML = `<div class="day-detail-empty">${year}년 다가오는 대회 일정이 없습니다.</div>`;
            return;
        }

        list.innerHTML = upcoming.map(item => {
            const t = item.tournament;
            const assocClass = t.association === 'KGA' ? 'kga' : t.association === 'KJGA' ? 'kjga' : t.association === '충남' ? 'chungnam' : 'custom';
            const typeClass = t.type === 'student' ? 'student' : t.type === 'open' ? 'open' : 'amateur';
            const isReg = this.tm.isRegistered(t.id);
            const color = t.isCustom ? PHASE_COLORS.custom : PHASE_COLORS.finals;
            const dLabel = item.daysUntil === 0 ? '오늘' : item.daysUntil === 1 ? '내일' : `D-${item.daysUntil}`;

            return `
            <div class="tournament-card" data-tournament-id="${t.id}" style="border-left-color:${color}">
                <div class="tournament-card-header">
                    <span class="tournament-card-title">${t.name}</span>
                    <div class="tournament-badges">
                        <span class="badge-assoc ${assocClass}">${t.association}</span>
                        <span class="badge-type ${typeClass}">${t.type === 'student' ? '학생' : t.type === 'open' ? '오픈' : '아마추어'}</span>
                    </div>
                </div>
                <div class="tournament-card-dates">
                    <span class="date-tag ${item.type}">${item.label} ${this._fmtShort(item.startDate)}~${this._fmtShort(item.endDate)} (${dLabel})</span>
                </div>
                <div class="tournament-card-footer">
                    <span class="tournament-venue">📍 ${t.venue}</span>
                    <button class="btn-register ${isReg ? 'checked' : ''}" data-tournament-id="${t.id}">
                        ${isReg ? '✅ 신청완료' : '☐ 신청'}
                    </button>
                </div>
            </div>`;
        }).join('');

        this._bindCardEvents(list);
    }

    _updateTimeDisplay() {
        const el = document.getElementById('updateTime');
        if (!el) return;
        if (this.tm.lastUpdated) {
            const d = this.tm.lastUpdated;
            const pad = n => String(n).padStart(2, '0');
            el.textContent = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } else {
            el.textContent = '업데이트 필요';
        }
    }

    _updateBadge() {
        const badge = document.getElementById('notifBadge');
        const count = this.nm.getBadgeCount();
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    }

    _refresh() {
        this.calendar.render();
        this._renderUpcoming();
        this._updateBadge();
        this._updateChangeLogBadge();
    }

    _renderChangeLogModal() {
        const body = document.getElementById('changeLogBody');
        const log = this.tm.getChangeLog();

        if (log.length === 0) {
            body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-tertiary)">변경 내역이 없습니다.<br><br>새로고침 버튼(↻)을 누르면<br>이전 데이터와 비교하여 변경사항을 감지합니다.</div>';
            return;
        }

        // 날짜별 그룹핑
        const grouped = {};
        for (const entry of log) {
            const d = new Date(entry.time);
            const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            if (!grouped[dateKey]) grouped[dateKey] = [];
            grouped[dateKey].push(entry);
        }

        let html = '';
        for (const [date, entries] of Object.entries(grouped)) {
            const d = new Date(date);
            html += `<div style="font-weight:700;font-size:14px;margin:16px 0 8px;color:var(--text-primary)">${d.getMonth()+1}월 ${d.getDate()}일</div>`;
            for (const entry of entries) {
                const icon = entry.type === 'added' ? '🆕' : entry.type === 'removed' ? '🗑️' : '✏️';
                const t = new Date(entry.time);
                const timeStr = `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`;
                html += `
                <div style="padding:8px 12px;margin:4px 0;background:var(--bg-secondary);border-radius:8px;font-size:13px;">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <span style="font-weight:600">${icon} ${entry.name}</span>
                        <span style="font-size:11px;color:var(--text-tertiary)">${timeStr}</span>
                    </div>
                    <div style="color:var(--text-secondary);margin-top:4px;font-size:12px">${entry.detail}</div>
                </div>`;
            }
        }

        html += `<div style="text-align:center;margin-top:16px">
            <button id="btnClearLog" style="padding:8px 16px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--text-secondary);cursor:pointer;font-size:12px">로그 초기화</button>
        </div>`;

        body.innerHTML = html;

        document.getElementById('btnClearLog')?.addEventListener('click', () => {
            localStorage.removeItem('golf-change-log');
            this._renderChangeLogModal();
            this._updateChangeLogBadge();
            showToast('변경 로그가 초기화되었습니다.');
        });
    }

    _updateChangeLogBadge() {
        const badge = document.getElementById('changeLogBadge');
        const log = this.tm.getChangeLog();
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const count = log.filter(c => new Date(c.time).getTime() > oneDayAgo).length;
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    }

    _fmtShort(dateStr) {
        const d = new Date(dateStr);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }
}

const app = new App();
app.init().then(() => {
    console.log('⛳ Golf Calendar App initialized');
}).catch(err => {
    console.error('Init failed:', err);
});
