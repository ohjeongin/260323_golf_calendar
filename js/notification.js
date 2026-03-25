// Notification Manager
// 대회 신청 기간 알림 관리 (D-7, D-1)

const SETTINGS_KEY = 'golf-notif-settings';
const LOG_KEY = 'golf-notif-log';

function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

class NotificationManager {
    constructor(tournamentManager) {
        this.manager = tournamentManager;
        this.settings = this._loadSettings();
        this.log = this._loadLog();
        this._checkInterval = null;
    }

    // 모든 대회에 대해 기본 알림 ON으로 초기화 (처음 로드 시)
    initializeDefaults() {
        for (const t of this.manager.tournaments) {
            if (!this.settings[t.id]) {
                this.settings[t.id] = { d7: true, d1: true };
            }
        }
        this._saveSettings();
    }

    getSettings(tournamentId) {
        return this.settings[tournamentId] || { d7: true, d1: true };
    }

    setSetting(tournamentId, key, value) {
        if (!this.settings[tournamentId]) this.settings[tournamentId] = { d7: true, d1: true };
        this.settings[tournamentId][key] = value;
        this._saveSettings();
    }

    requestPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    startChecking() {
        this._checkOnce();
        // 6시간마다 확인
        this._checkInterval = setInterval(() => this._checkOnce(), 6 * 60 * 60 * 1000);
    }

    stopChecking() {
        if (this._checkInterval) clearInterval(this._checkInterval);
    }

    sendImmediateNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, icon: './icons/icon-192.png' });
        }
    }

    // 알림 패널 HTML 생성
    buildPanelContent() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcoming = this.manager.getUpcoming(20);
        const regUpcoming = upcoming.filter(item => item.type === 'registration');

        let html = '';

        // 신청 D-7 이내 항목
        const soon = regUpcoming.filter(item => item.daysUntil <= 7 && item.daysUntil >= 0);
        if (soon.length > 0) {
            html += `<div class="notif-section">
                <div class="notif-section-title">⚠️ 신청 임박 (7일 이내)</div>`;
            for (const item of soon) {
                const t = item.tournament;
                html += `
                <div class="notification-item" data-tournament-id="${t.id}">
                    <div class="notif-item-name">${t.name}</div>
                    <div class="notif-item-date">신청: ${item.startDate} ~ ${item.endDate}</div>
                    <div class="notif-item-days">${item.daysUntil === 0 ? '오늘 시작!' : `D-${item.daysUntil}`}</div>
                </div>`;
            }
            html += `</div>`;
        }

        // 다가오는 전체 신청 일정
        if (regUpcoming.length > 0) {
            html += `<div class="notif-section">
                <div class="notif-section-title">📋 다가오는 신청 일정</div>`;
            for (const item of regUpcoming.slice(0, 8)) {
                const t = item.tournament;
                html += `
                <div class="notification-item" data-tournament-id="${t.id}">
                    <div class="notif-item-name">${t.name}</div>
                    <div class="notif-item-date">신청: ${item.startDate} ~ ${item.endDate}</div>
                    <div class="notif-item-days">D-${item.daysUntil}</div>
                </div>`;
            }
            html += `</div>`;
        }

        if (regUpcoming.length === 0 && soon.length === 0) {
            html += `<div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px;">다가오는 신청 일정이 없습니다.</div>`;
        }

        // 변경 로그
        const changeLog = this.manager.getChangeLog();
        if (changeLog.length > 0) {
            html += `<div class="notif-section">
                <div class="notif-section-title">📝 업데이트 로그</div>`;
            for (const entry of changeLog.slice(0, 15)) {
                const icon = entry.type === 'added' ? '🆕' : entry.type === 'removed' ? '🗑️' : '✏️';
                const time = new Date(entry.time);
                const timeStr = `${time.getMonth()+1}/${time.getDate()} ${time.getHours()}:${String(time.getMinutes()).padStart(2,'0')}`;
                html += `
                <div class="notification-item">
                    <div class="notif-item-name">${icon} ${entry.name}</div>
                    <div class="notif-item-date">${entry.detail}</div>
                    <div class="notif-item-days" style="font-size:11px;color:var(--text-tertiary)">${timeStr}</div>
                </div>`;
            }
            html += `</div>`;
        }

        // 테스트 알림 버튼
        html += `
        <div class="notif-section" style="margin-top:16px;">
            <button class="btn-notif-action" id="btnTestNotif">🔔 테스트 알림 보내기</button>
        </div>`;

        return html;
    }

    // 배지 카운트 (D-7 이내 신청 임박 + 최근 변경사항)
    getBadgeCount() {
        const upcoming = this.manager.getUpcoming(50);
        const regCount = upcoming.filter(item => item.type === 'registration' && item.daysUntil <= 7 && item.daysUntil >= 0).length;
        // 최근 24시간 내 변경사항
        const changeLog = this.manager.getChangeLog();
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recentChanges = changeLog.filter(c => new Date(c.time).getTime() > oneDayAgo).length;
        return regCount + recentChanges;
    }

    _checkOnce() {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];

        for (const t of this.manager.tournaments) {
            const settings = this.getSettings(t.id);
            if (!t.dates.registration) continue;

            const regStart = new Date(t.dates.registration.start);
            const days = Math.ceil((regStart - today) / 86400000);

            const logKey7 = `${t.id}-d7-${todayStr}`;
            const logKey1 = `${t.id}-d1-${todayStr}`;

            if (settings.d7 && days === 7 && !this.log[logKey7]) {
                this.sendImmediateNotification(
                    `⛳ 신청 D-7: ${t.name}`,
                    `7일 후 신청이 시작됩니다. 준비하세요!`
                );
                this.log[logKey7] = true;
                this._saveLog();
            }

            if (settings.d1 && days === 1 && !this.log[logKey1]) {
                this.sendImmediateNotification(
                    `🚨 신청 D-1: ${t.name}`,
                    `내일부터 신청이 시작됩니다!`
                );
                this.log[logKey1] = true;
                this._saveLog();
            }
        }
    }

    _loadSettings() {
        try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
        catch { return {}; }
    }
    _saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); }

    _loadLog() {
        try { return JSON.parse(localStorage.getItem(LOG_KEY) || '{}'); }
        catch { return {}; }
    }
    _saveLog() { localStorage.setItem(LOG_KEY, JSON.stringify(this.log)); }
}

export default NotificationManager;
export { showToast };
