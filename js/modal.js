// Tournament Detail Modal Manager

class Modal {
    constructor(tournamentManager, notificationManager, onUpdate) {
        this.manager = tournamentManager;
        this.notifManager = notificationManager;
        this.onUpdate = onUpdate;
        this.overlay = document.getElementById('modalOverlay');
        this.titleEl = document.getElementById('modalTitle');
        this.bodyEl = document.getElementById('modalBody');
        this._bindEvents();
    }

    show(tournament) {
        this.current = tournament;
        this.titleEl.textContent = tournament.name;
        this.bodyEl.innerHTML = this._buildContent(tournament);
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        this._bindModalEvents(tournament);
    }

    hide() {
        this.overlay.classList.remove('active');
        document.body.style.overflow = '';
        this.current = null;
    }

    _bindEvents() {
        document.getElementById('modalClose').addEventListener('click', () => this.hide());
        this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.hide(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this.hide(); });
    }

    _buildContent(t) {
        const assocClass = t.association === 'KGA' ? 'kga' : t.association === 'KJGA' ? 'kjga' : t.association === '충남' ? 'chungnam' : 'custom';
        const typeClass = t.type === 'student' ? 'student' : t.type === 'open' ? 'open' : 'amateur';
        const typeLabel = t.type === 'student' ? '학생부' : t.type === 'open' ? '오픈' : t.isCustom ? '개인일정' : '아마추어';
        const isRegistered = this.manager.isRegistered(t.id);
        const notif = this.notifManager.getSettings(t.id);

        const unverifiedNotice = (!t.verified && !t.isCustom)
            ? `<div class="unverified-notice">⚠️ 이 대회의 일정은 미확인 상태입니다. 신청 전 반드시 공식 사이트에서 확인하세요.</div>`
            : '';

        return `
            ${unverifiedNotice}
            <div class="modal-section">
                <div class="tournament-badges">
                    <span class="badge-assoc ${assocClass}">${t.association}</span>
                    <span class="badge-type ${typeClass}">${typeLabel}</span>
                </div>
            </div>

            <div class="modal-section">
                <h4 class="modal-section-title">📅 일정</h4>
                <div class="timeline">
                    ${this._timelineItem('registration', '신청 기간', t.dates.registration)}
                    ${this._timelineItem('qualification', '예선', t.dates.qualification)}
                    ${this._timelineItem('finals', '본선', t.dates.finals)}
                    ${this._timelineItem('practice', '연습라운딩', t.dates.practice)}
                </div>
            </div>

            <div class="modal-section">
                <h4 class="modal-section-title">ℹ️ 대회 정보</h4>
                <div class="modal-info-grid">
                    <div class="modal-info-item">
                        <div class="modal-info-label">장소</div>
                        <div class="modal-info-value">📍 ${t.venue}</div>
                    </div>
                    <div class="modal-info-item">
                        <div class="modal-info-label">참가 부문</div>
                        <div class="modal-info-value">${(t.categories || []).join(', ')}</div>
                    </div>
                </div>
            </div>

            <div class="modal-section">
                <h4 class="modal-section-title">🔔 알림 설정</h4>
                <div class="notification-settings">
                    <div class="notification-toggle">
                        <div class="notification-toggle-info">
                            <span class="notification-toggle-label">신청 시작 7일 전</span>
                            <span class="notification-toggle-desc">D-7 알림을 받습니다</span>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="notif-d7" ${notif.d7 ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="notification-toggle">
                        <div class="notification-toggle-info">
                            <span class="notification-toggle-label">신청 시작 1일 전</span>
                            <span class="notification-toggle-desc">D-1 알림을 받습니다</span>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="notif-d1" ${notif.d1 ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>

            <div class="modal-section">
                <button class="btn-modal-register ${isRegistered ? 'checked' : ''}" id="modalRegisterBtn">
                    ${isRegistered ? '✅ 신청 완료' : '☐ 신청 완료로 표시'}
                </button>
                ${t.isCustom
                    ? `<button class="btn-delete" id="modalDeleteBtn">🗑️ 이 개인 일정 삭제하기</button>`
                    : `<a href="${t.url}" target="_blank" rel="noopener" class="btn-modal-link">🔗 협회 사이트에서 보기</a>`
                }
            </div>
        `;
    }

    _timelineItem(type, label, dates) {
        if (!dates) {
            return `
                <div class="timeline-item">
                    <div class="timeline-dot ${type}"></div>
                    <div class="timeline-label">${label}</div>
                    <div class="timeline-na">해당 없음</div>
                </div>`;
        }
        const start = this._korDate(dates.start);
        const end = this._korDate(dates.end);
        const dateStr = dates.start === dates.end ? start : `${start} ~ ${end}`;
        const days = Math.ceil((new Date(dates.start) - new Date()) / 86400000);
        let badge = '';
        if (days === 0) badge = ' <span style="color:var(--color-finals)">(오늘!)</span>';
        else if (days > 0) badge = ` <span style="color:var(--text-tertiary)">(D-${days})</span>`;
        else badge = ` <span style="color:var(--text-tertiary)">(완료)</span>`;

        return `
            <div class="timeline-item">
                <div class="timeline-dot ${type}"></div>
                <div class="timeline-label">${label}${badge}</div>
                <div class="timeline-date">${dateStr}</div>
            </div>`;
    }

    _korDate(dateStr) {
        const d = new Date(dateStr);
        const days = ['일','월','화','수','목','금','토'];
        return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
    }

    _bindModalEvents(t) {
        const regBtn = document.getElementById('modalRegisterBtn');
        if (regBtn) {
            regBtn.addEventListener('click', () => {
                const now = this.manager.toggleRegistered(t.id);
                regBtn.className = `btn-modal-register ${now ? 'checked' : ''}`;
                regBtn.innerHTML = now ? '✅ 신청 완료' : '☐ 신청 완료로 표시';
                if (this.onUpdate) this.onUpdate();
            });
        }

        const d7 = document.getElementById('notif-d7');
        const d1 = document.getElementById('notif-d1');
        if (d7) d7.addEventListener('change', () => {
            this.notifManager.setSetting(t.id, 'd7', d7.checked);
            if (d7.checked) this.notifManager.requestPermission();
        });
        if (d1) d1.addEventListener('change', () => {
            this.notifManager.setSetting(t.id, 'd1', d1.checked);
            if (d1.checked) this.notifManager.requestPermission();
        });

        const delBtn = document.getElementById('modalDeleteBtn');
        if (delBtn && t.isCustom) {
            delBtn.addEventListener('click', () => {
                if (confirm('이 개인 일정을 삭제하시겠습니까?')) {
                    this.manager.deleteCustomEvent(t.id);
                    this.hide();
                    if (this.onUpdate) this.onUpdate();
                }
            });
        }
    }
}

export default Modal;
