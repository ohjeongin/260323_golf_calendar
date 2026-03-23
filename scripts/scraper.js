/**
 * Golf Tournament Scraper
 * KGA / KJGA / 충남골프협회 대회 일정 자동 수집
 *
 * 실행: node scraper.js
 * 출력: ../data/tournaments.json 업데이트
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../data/tournaments.json');
const TODAY = new Date().toISOString().split('T')[0];

// 제외 키워드 (시니어, 초등 등)
const EXCLUDED = ['시니어', 'senior', '그랜드시니어', '미드시니어', '초등', '어린이', '유소년'];

const http = axios.create({
    timeout: 15000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9'
    }
});

function shouldExclude(name) {
    const lower = name.toLowerCase();
    return EXCLUDED.some(kw => lower.includes(kw.toLowerCase()));
}

function toDateStr(yyyymmdd) {
    if (!yyyymmdd || yyyymmdd.length < 8) return null;
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function guessType(name) {
    if (/오픈|open/i.test(name)) return 'open';
    if (/중학|고등|학생|주니어|중고등/i.test(name)) return 'student';
    return 'amateur';
}

// ============================================================
// KGA 스크래퍼
// ============================================================
async function scrapeKGA(year = new Date().getFullYear()) {
    console.log(`[KGA] ${year}년 일정 수집 시작...`);
    const tourMap = new Map(); // tournamentCode → tournament data

    try {
        // KGA 일정 목록 API 호출
        const resp = await http.post(
            'https://www.kgagolf.or.kr/load/web/elite/scheduleList',
            `season=${year}`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://www.kgagolf.or.kr/web/elite/schedule' } }
        );

        const $ = cheerio.load(resp.data);

        $('.schedule-entry').each((i, el) => {
            const entry = $(el);

            // 대회 코드 추출
            const href = entry.find('a[href*="tournamentCode"]').attr('href') || '';
            const codeMatch = href.match(/tournamentCode=(\d+)/);
            if (!codeMatch) return;
            const code = codeMatch[1];

            // 대회명 (부문 접미사 제거)
            const rawName = entry.find('span.fs-4, span.fw-sb').first().text().trim();
            if (!rawName || shouldExclude(rawName)) return;

            const cleanName = rawName
                .replace(/\s*\(예선전[^)]*\)/g, '')
                .replace(/\s*\(본선[^)]*\)/g, '')
                .replace(/\s*\([가-힣A-Za-z\s]+부\s*[A-Z]?\)/g, '')
                .trim();

            const startDate = toDateStr(entry.attr('data-startdate'));
            const endDate = toDateStr(entry.attr('data-enddate'));
            const isFinal = entry.attr('data-finalyn') === 'Y';

            // 장소
            const venueText = entry.find('h5').eq(1).text().trim();
            const venue = venueText.split('/')[0].trim() || '미정';

            if (!tourMap.has(code)) {
                tourMap.set(code, {
                    code,
                    name: cleanName,
                    venue,
                    registration: null,
                    qualification: null,
                    finals: null
                });
            }

            const t = tourMap.get(code);

            // 더 긴 이름 우선
            if (cleanName.length > t.name.length) t.name = cleanName;

            if (isFinal) {
                // 본선: 날짜 범위 확장
                if (!t.finals) {
                    t.finals = { start: startDate, end: endDate };
                } else {
                    if (startDate < t.finals.start) t.finals.start = startDate;
                    if (endDate > t.finals.end) t.finals.end = endDate;
                }
            } else {
                // 예선: 날짜 범위 확장
                if (!t.qualification) {
                    t.qualification = { start: startDate, end: endDate };
                } else {
                    if (startDate < t.qualification.start) t.qualification.start = startDate;
                    if (endDate > t.qualification.end) t.qualification.end = endDate;
                }
            }
        });

        console.log(`[KGA] ${tourMap.size}개 대회 발견, 상세 정보 수집 중...`);

        // 각 대회 상세 페이지에서 신청 기간 가져오기
        for (const [code, t] of tourMap) {
            try {
                const detail = await http.get(
                    `https://www.kgagolf.or.kr/web/elite/tour/tourInfo?tournamentCode=${code}`
                );
                const $d = cheerio.load(detail.data);

                // 신청기간 탐색
                $d('tr, li, div').each((i, el) => {
                    const text = $d(el).text();
                    if (!/(신청|접수)\s*기간/.test(text)) return;

                    const datePattern = /(\d{4})[.\-\/\s](\d{1,2})[.\-\/\s](\d{1,2})/g;
                    const matches = [...text.matchAll(datePattern)];
                    if (matches.length >= 2) {
                        const fmt = m => `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
                        t.registration = { start: fmt(matches[0]), end: fmt(matches[1]) };
                        return false; // break
                    }
                });

                await sleep(300); // 과도한 요청 방지
            } catch (e) {
                // 상세 페이지 실패는 무시
            }
        }

    } catch (e) {
        console.error('[KGA] 오류:', e.message);
    }

    // 결과 변환
    const results = [];
    for (const [code, t] of tourMap) {
        const dateYear = parseInt(
            t.finals?.start?.slice(0, 4) ||
            t.qualification?.start?.slice(0, 4) ||
            t.registration?.start?.slice(0, 4) ||
            String(year)
        );

        results.push({
            id: `kga-${dateYear}-${code}`,
            name: t.name,
            association: 'KGA',
            type: guessType(t.name),
            year: dateYear,
            verified: true,
            lastVerified: TODAY,
            dates: {
                registration: t.registration,
                qualification: t.qualification,
                finals: t.finals,
                practice: null
            },
            venue: t.venue,
            categories: [],
            url: `https://www.kgagolf.or.kr/web/elite/tour/tourInfo?tournamentCode=${code}`
        });
    }

    console.log(`[KGA] ${results.length}개 대회 수집 완료`);
    return results;
}

// ============================================================
// KJGA 스크래퍼
// ============================================================
async function scrapeKJGA() {
    console.log('[KJGA] 일정 수집 시작...');
    const results = [];

    const urls = [
        'http://www.kjga.or.kr/n_Public/s24.asp',
        'https://www.kjga.or.kr/n_Public/s24.asp'
    ];

    let html = null;
    for (const url of urls) {
        try {
            const resp = await http.get(url);
            html = resp.data;
            console.log(`[KJGA] 접속 성공: ${url}`);
            break;
        } catch (e) {
            console.log(`[KJGA] 접속 실패: ${url} - ${e.message}`);
        }
    }

    if (!html) {
        console.log('[KJGA] 모든 URL 접속 실패, 기존 데이터 유지');
        return null; // null 반환 시 기존 데이터 유지
    }

    const $ = cheerio.load(html);

    // 공지 목록에서 대회 일정 링크 추출
    const noticeLinks = [];
    $('a[href*="s24"], a[href*="notice"], a[href*="bbs"], table a').each((i, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr('href') || '';
        // 대회 관련 공지만 선택
        if (/대회|골프|선수권|배\s/.test(text) && text.length > 5) {
            const fullUrl = href.startsWith('http') ? href :
                href.startsWith('/') ? `http://www.kjga.or.kr${href}` :
                `http://www.kjga.or.kr/n_Public/${href}`;
            noticeLinks.push({ text, url: fullUrl });
        }
    });

    console.log(`[KJGA] 공지 ${noticeLinks.length}개 발견`);

    // 각 공지에서 일정 정보 추출
    for (const notice of noticeLinks.slice(0, 20)) {
        try {
            const resp = await http.get(notice.url);
            const $n = cheerio.load(resp.data);
            const body = $n('body').text();

            // 날짜 패턴 탐색
            const datePattern = /(\d{4})[.\-\/\s](\d{1,2})[.\-\/\s](\d{1,2})/g;
            const dates = [...body.matchAll(datePattern)].map(m =>
                `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`
            ).filter(d => d.startsWith('202')); // 2020년대 날짜만

            if (dates.length < 1) continue;

            // 장소 패턴
            const venueMatch = body.match(/[가-힣]+\s*(?:C\.?C|CC|골프클럽|골프장)/);
            const venue = venueMatch ? venueMatch[0].trim() : '미정';

            // 이름 추정 (notice.text 사용)
            const name = notice.text.replace(/^\d+\.\s*/, '').trim();
            if (!name || shouldExclude(name)) continue;

            const year = parseInt(dates[0].slice(0, 4));
            const id = `kjga-${year}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;

            results.push({
                id,
                name,
                association: 'KJGA',
                type: 'student',
                year,
                verified: true,
                lastVerified: TODAY,
                dates: {
                    registration: dates.length >= 2 ? { start: dates[0], end: dates[1] } : null,
                    qualification: null,
                    finals: dates.length >= 2 ? { start: dates[dates.length-2], end: dates[dates.length-1] } : { start: dates[0], end: dates[0] },
                    practice: null
                },
                venue,
                categories: ['남자 고등부', '남자 중등부', '여자 고등부', '여자 중등부'],
                url: notice.url
            });

            await sleep(300);
        } catch {}
    }

    // KJGA 개별 대회 페이지도 시도
    const extraUrls = [
        'http://www.kjga.or.kr/n_Public/s51.asp',
        'http://www.kjga.or.kr/n_Public/s52.asp'
    ];
    for (const url of extraUrls) {
        try {
            const resp = await http.get(url);
            const $ = cheerio.load(resp.data);
            // 상세 파싱은 s24.asp와 동일 방식
            console.log(`[KJGA] 추가 페이지 확인: ${url}`);
        } catch {}
    }

    console.log(`[KJGA] ${results.length}개 대회 수집 완료`);
    return results;
}

// ============================================================
// 충남골프협회 스크래퍼
// ============================================================
async function scrapeChungnam() {
    console.log('[충남] 일정 수집 시작...');
    const results = [];

    try {
        const resp = await http.get(
            'https://041-634-6821.kweb114.co.kr/m/sub.html?mc=5215&mo=1&mn=4878&ms=4877'
        );
        const $ = cheerio.load(resp.data);
        const fullText = $('body').text();
        const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);

        // 날짜 패턴으로 이벤트 탐색
        // 형식: "03-23~24 : 이벤트명 (장소)" 또는 "03-23 이벤트명"
        const dateLinePattern = /(\d{2})-(\d{2})(?:~(\d{2}))?\s*[:\s]\s*(.+)/;
        const year = new Date().getFullYear();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const m = line.match(dateLinePattern);
            if (!m) continue;

            const [, month, startDay, endDay, rest] = m;
            const startDate = `${year}-${month}-${startDay}`;
            const endDate = endDay ? `${year}-${month}-${endDay}` : startDate;

            // 이름과 장소 분리
            const nameVenueSplit = rest.split(/[(\（]/);
            const name = nameVenueSplit[0].replace(/\s*:\s*/, '').trim();
            const venueMatch = rest.match(/[(\（]([^)）]+)[)）]/);
            const venue = venueMatch ? venueMatch[1].trim() : '미정';

            if (!name || name.length < 3) continue;

            results.push({
                id: `cn-${year}-${month}${startDay}`,
                name: name.includes('충남') || name.includes('충청') ? name : `${name}`,
                association: '충남',
                type: guessType(name),
                year,
                verified: true,
                lastVerified: TODAY,
                dates: {
                    registration: null,
                    qualification: null,
                    finals: { start: startDate, end: endDate },
                    practice: null
                },
                venue,
                categories: [],
                url: 'https://041-634-6821.kweb114.co.kr/m/sub.html?mc=5215&mo=1&mn=4878&ms=4877'
            });
        }

        console.log(`[충남] ${results.length}개 대회 수집 완료`);
    } catch (e) {
        console.error('[충남] 오류:', e.message);
    }

    return results;
}

// ============================================================
// 기존 데이터와 병합
// ============================================================
function mergeData(existing, scraped) {
    // 커스텀/개인 일정은 항상 보존
    const custom = existing.filter(t => t.isCustom || t.association === '개인일정');

    // 스크래핑된 데이터로 공식 대회 업데이트 (ID 기준)
    const scrapedMap = new Map(scraped.map(t => [t.id, t]));
    const existingMap = new Map(existing.filter(t => !t.isCustom).map(t => [t.id, t]));

    // 기존 ID와 새 ID 병합
    const merged = new Map([...existingMap, ...scrapedMap]);

    return [...merged.values(), ...custom];
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 메인 실행
// ============================================================
async function main() {
    console.log('='.repeat(50));
    console.log(`골프 대회 일정 스크래퍼 시작: ${TODAY}`);
    console.log('='.repeat(50));

    // 기존 데이터 로드
    let existing = [];
    try {
        existing = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
        console.log(`기존 데이터: ${existing.length}개`);
    } catch {
        console.log('기존 데이터 없음, 새로 생성');
    }

    const allScraped = [];

    // KGA 스크래핑 (올해 + 내년)
    const currentYear = new Date().getFullYear();
    for (const year of [currentYear, currentYear + 1]) {
        try {
            const kga = await scrapeKGA(year);
            allScraped.push(...kga);
        } catch (e) {
            console.error(`[KGA] ${year}년 스크래핑 실패:`, e.message);
        }
    }

    // KJGA 스크래핑
    try {
        const kjga = await scrapeKJGA();
        if (kjga !== null) {
            allScraped.push(...kjga);
        } else {
            // KJGA 사이트 다운 시 기존 KJGA 데이터 유지
            const existingKJGA = existing.filter(t => t.association === 'KJGA');
            allScraped.push(...existingKJGA);
            console.log(`[KJGA] 기존 데이터 ${existingKJGA.length}개 유지`);
        }
    } catch (e) {
        console.error('[KJGA] 스크래핑 실패:', e.message);
        allScraped.push(...existing.filter(t => t.association === 'KJGA'));
    }

    // 충남 스크래핑
    try {
        const cn = await scrapeChungnam();
        // 충남은 스크래핑 결과가 너무 적으면 기존 데이터 유지
        if (cn.length >= 2) {
            allScraped.push(...cn);
        } else {
            allScraped.push(...existing.filter(t => t.association === '충남'));
            console.log('[충남] 스크래핑 결과 부족, 기존 데이터 유지');
        }
    } catch (e) {
        console.error('[충남] 스크래핑 실패:', e.message);
        allScraped.push(...existing.filter(t => t.association === '충남'));
    }

    // 병합 및 저장
    const merged = mergeData(existing, allScraped);

    // 중복 제거 및 정렬
    const deduped = [...new Map(merged.map(t => [t.id, t])).values()];
    deduped.sort((a, b) => {
        const aDate = a.dates.finals?.start || a.dates.qualification?.start || a.dates.registration?.start || '9999';
        const bDate = b.dates.finals?.start || b.dates.qualification?.start || b.dates.registration?.start || '9999';
        return aDate.localeCompare(bDate);
    });

    fs.writeFileSync(DATA_PATH, JSON.stringify(deduped, null, 2), 'utf-8');

    console.log('='.repeat(50));
    console.log(`완료! 총 ${deduped.length}개 대회 저장 (기존: ${existing.length}개)`);
    console.log(`저장 위치: ${DATA_PATH}`);
    console.log('='.repeat(50));
}

main().catch(e => {
    console.error('스크래퍼 실패:', e);
    process.exit(1);
});
