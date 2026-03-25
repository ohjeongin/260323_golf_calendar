/**
 * Golf Tournament Scraper v2
 * KGA / KJGA / 충남골프협회 대회 일정 자동 수집
 *
 * KGA: scheduleList (대회일정) + applyList (신청기간) 양쪽 API 활용
 * KJGA: 공지 상세 페이지에서 "일시:", "신청마감:" 키워드 기반 파싱
 * 충남: 페이지 텍스트 파싱
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
const CURRENT_YEAR = new Date().getFullYear();

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
    const s = String(yyyymmdd);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function guessType(name) {
    if (/오픈|open/i.test(name)) return 'open';
    if (/중학|고등|학생|주니어|중고등/i.test(name)) return 'student';
    return 'amateur';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * "3. 10 .(화) 10시" 같은 KGA 날짜를 파싱해서 { month, day } 반환
 */
function parseKGADate(text, year) {
    // "3. 10" 또는 "3.10" 또는 "3. 10 .(화)"
    const m = text.match(/(\d{1,2})\s*\.\s*(\d{1,2})/);
    if (!m) return null;
    const month = m[1].padStart(2, '0');
    const day = m[2].padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ============================================================
// KGA 스크래퍼 (scheduleList + applyList 결합)
// ============================================================
async function scrapeKGA(year = CURRENT_YEAR) {
    console.log(`[KGA] ${year}년 일정 수집 시작...`);

    // tournamentCode → { name, venue, registration, dates(예선/본선) }
    const tourMap = new Map();

    // --- 1단계: scheduleList에서 대회 일정(예선/본선) 수집 ---
    try {
        const resp = await http.post(
            'https://www.kgagolf.or.kr/load/web/elite/scheduleList',
            `season=${year}`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://www.kgagolf.or.kr/web/elite/schedule' } }
        );
        const $ = cheerio.load(resp.data);

        $('.schedule-entry').each((i, el) => {
            const entry = $(el);
            const href = entry.find('a[href*="tournamentCode"]').attr('href') || '';
            const codeMatch = href.match(/tournamentCode=(\d+)/);
            if (!codeMatch) return;
            const code = codeMatch[1];

            const rawName = entry.find('span.fs-4, span.fw-sb').first().text().trim();
            if (!rawName || shouldExclude(rawName)) return;

            // 대회명에서 부문/조 정보 제거 → 상위 대회명만
            const cleanName = rawName
                .replace(/\s*\(예선전[^)]*\)/g, '')
                .replace(/\s*\(본선[^)]*\)/g, '')
                .replace(/\s*\(최종\s*예선전[^)]*\)/g, '')
                .replace(/\s*\(1차\s*예선전[^)]*\)/g, '')
                .replace(/\s*\([가-힣A-Za-z\s]+부\s*[A-Z]?\)/g, '')
                .trim();

            const startDate = toDateStr(entry.attr('data-startdate'));
            const endDate = toDateStr(entry.attr('data-enddate'));
            const isFinal = entry.attr('data-finalyn') === 'Y';

            const venueText = entry.find('h5').eq(1).text().replace(/\s+/g, ' ').trim();
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
            if (cleanName.length > t.name.length) t.name = cleanName;

            if (isFinal) {
                if (!t.finals) {
                    t.finals = { start: startDate, end: endDate };
                } else {
                    if (startDate && startDate < t.finals.start) t.finals.start = startDate;
                    if (endDate && endDate > t.finals.end) t.finals.end = endDate;
                }
            } else {
                if (!t.qualification) {
                    t.qualification = { start: startDate, end: endDate };
                } else {
                    if (startDate && startDate < t.qualification.start) t.qualification.start = startDate;
                    if (endDate && endDate > t.qualification.end) t.qualification.end = endDate;
                }
            }
        });

        console.log(`[KGA] scheduleList: ${tourMap.size}개 대회 발견`);
    } catch (e) {
        console.error('[KGA] scheduleList 오류:', e.message);
    }

    // --- 2단계: applyList에서 신청기간 수집 ---
    try {
        const resp = await http.post(
            'https://www.kgagolf.or.kr/load/web/elite/applyList',
            `season=${year}`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://www.kgagolf.or.kr/web/elite/schedule' } }
        );
        const $ = cheerio.load(resp.data);

        $('.schedule-entry').each((i, el) => {
            const entry = $(el);
            const href = entry.find('a[href*="tournamentCode"]').attr('href') || '';
            const codeMatch = href.match(/tournamentCode=(\d+)/);
            if (!codeMatch) return;
            const code = codeMatch[1];

            const text = entry.text().replace(/\s+/g, ' ').trim();

            // 참가신청기간 파싱: "참가신청기간 3. 10 .(화) 10시 ~ 3. 16 .(월) 16시"
            const regMatch = text.match(/참가신청기간\s+([\d\s.()가-힣시]+?)\s*~\s*([\d\s.()가-힣시]+?)(?:\s+장소|\s+추가|\s+대회기간)/);
            if (regMatch) {
                const regStart = parseKGADate(regMatch[1], year);
                const regEnd = parseKGADate(regMatch[2], year);
                if (regStart && regEnd) {
                    // scheduleList에 없었던 대회도 applyList에 있을 수 있음
                    if (!tourMap.has(code)) {
                        const rawName = text.match(/\|\s*(.+?)\s*참가신청기간/);
                        const name = rawName ? rawName[1].trim() : `대회 ${code}`;
                        const venueMatch = text.match(/장소\s*\/\s*코스\s+([\S]+)/);
                        tourMap.set(code, {
                            code,
                            name: name.replace(/\s*\(예선전[^)]*\)/g, '').replace(/\s*\(본선[^)]*\)/g, '').replace(/\s*\([가-힣A-Za-z\s]+부\s*[A-Z]?\)/g, '').trim(),
                            venue: venueMatch ? venueMatch[1] : '미정',
                            registration: null,
                            qualification: null,
                            finals: null
                        });
                    }

                    const t = tourMap.get(code);
                    if (!t.registration) {
                        t.registration = { start: regStart, end: regEnd };
                    } else {
                        // 가장 빠른 시작, 가장 늦은 종료
                        if (regStart < t.registration.start) t.registration.start = regStart;
                        if (regEnd > t.registration.end) t.registration.end = regEnd;
                    }
                }
            }

            // 대회기간도 보강: "대회기간 4. 7 .(화) ~ 4. 10 .(금)"
            const tourDateMatch = text.match(/대회기간\s+([\d\s.()가-힣]+?)\s*~\s*([\d\s.()가-힣]+?)$/);
            if (tourDateMatch && tourMap.has(code)) {
                const tStart = parseKGADate(tourDateMatch[1], year);
                const tEnd = parseKGADate(tourDateMatch[2], year);
                if (tStart && tEnd) {
                    const t = tourMap.get(code);
                    // qualification/finals 가 없으면 보강
                    if (!t.qualification && !t.finals) {
                        t.qualification = { start: tStart, end: tEnd };
                    }
                }
            }
        });

        console.log(`[KGA] applyList: 신청기간 반영 완료`);
    } catch (e) {
        console.error('[KGA] applyList 오류:', e.message);
    }

    // --- 3단계: 같은 대회명 그룹핑 (예선 A/B/C/D 등을 하나로 병합) ---
    const nameMap = new Map(); // cleanName → merged tournament
    for (const [code, t] of tourMap) {
        const baseName = t.name;
        if (!nameMap.has(baseName)) {
            nameMap.set(baseName, { ...t, codes: [code] });
        } else {
            const merged = nameMap.get(baseName);
            merged.codes.push(code);

            // 날짜 범위 확장
            if (t.registration) {
                if (!merged.registration) {
                    merged.registration = { ...t.registration };
                } else {
                    if (t.registration.start < merged.registration.start) merged.registration.start = t.registration.start;
                    if (t.registration.end > merged.registration.end) merged.registration.end = t.registration.end;
                }
            }
            if (t.qualification) {
                if (!merged.qualification) {
                    merged.qualification = { ...t.qualification };
                } else {
                    if (t.qualification.start < merged.qualification.start) merged.qualification.start = t.qualification.start;
                    if (t.qualification.end > merged.qualification.end) merged.qualification.end = t.qualification.end;
                }
            }
            if (t.finals) {
                if (!merged.finals) {
                    merged.finals = { ...t.finals };
                } else {
                    if (t.finals.start < merged.finals.start) merged.finals.start = t.finals.start;
                    if (t.finals.end > merged.finals.end) merged.finals.end = t.finals.end;
                }
            }
        }
    }

    // 결과 변환
    const results = [];
    for (const [name, t] of nameMap) {
        const dateYear = parseInt(
            t.finals?.start?.slice(0, 4) ||
            t.qualification?.start?.slice(0, 4) ||
            t.registration?.start?.slice(0, 4) ||
            String(year)
        );

        results.push({
            id: `kga-${dateYear}-${t.codes[0]}`,
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
            url: `https://www.kgagolf.or.kr/web/elite/tour/tourInfo?tournamentCode=${t.codes[0]}`
        });
    }

    console.log(`[KGA] ${results.length}개 대회 수집 완료 (그룹핑 후)`);
    return results;
}

// ============================================================
// KJGA 스크래퍼 (공지 상세 페이지에서 키워드 기반 파싱)
// ============================================================
async function scrapeKJGA() {
    console.log('[KJGA] 일정 수집 시작...');
    const results = [];

    let html = null;
    try {
        const resp = await http.get('http://www.kjga.or.kr/n_Public/s24.asp');
        html = resp.data;
        console.log('[KJGA] 목록 페이지 접속 성공');
    } catch (e) {
        console.log(`[KJGA] 접속 실패: ${e.message}`);
        return null;
    }

    const $ = cheerio.load(html);

    // 공지 목록에서 대회 관련 링크 추출
    const noticeLinks = [];
    const seen = new Set();

    // 같은 num에 대해 숫자(번호)와 텍스트(제목) 두 개의 <a>가 있음
    // 제목이 있는 링크만 수집
    const linksByNum = new Map();
    $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        if (!href.includes('s24_view')) return;
        const text = $(el).text().trim();
        const numMatch = href.match(/num=(\d+)/);
        if (!numMatch) return;
        const num = numMatch[1];
        // 더 긴 텍스트(제목)를 우선
        if (!linksByNum.has(num) || text.length > linksByNum.get(num).length) {
            linksByNum.set(num, text);
        }
    });

    for (const [num, text] of linksByNum) {
        if (text.length > 5) {
            const fullUrl = `http://www.kjga.or.kr/n_Public/s24_view.asp?num=${num}&page=1`;
            noticeLinks.push({ text, url: fullUrl, num });
            console.log(`[KJGA]   공지: ${text}`);
        }
        seen.add(num);
    }

    // 여러 페이지도 확인 (2~5페이지)
    for (let page = 2; page <= 5; page++) {
        try {
            const resp = await http.get(`http://www.kjga.or.kr/n_Public/s24.asp?page=${page}`);
            const $p = cheerio.load(resp.data);
            const pageLinksByNum = new Map();
            $p('a').each((i, el) => {
                const href = $p(el).attr('href') || '';
                if (!href.includes('s24_view')) return;
                const text = $p(el).text().trim();
                const numMatch = href.match(/num=(\d+)/);
                if (!numMatch) return;
                const num = numMatch[1];
                if (!pageLinksByNum.has(num) || text.length > pageLinksByNum.get(num).length) {
                    pageLinksByNum.set(num, text);
                }
            });
            for (const [num, text] of pageLinksByNum) {
                if (seen.has(num)) continue;
                seen.add(num);
                if (text.length > 5) {
                    const fullUrl = `http://www.kjga.or.kr/n_Public/s24_view.asp?num=${num}&page=${page}`;
                    noticeLinks.push({ text, url: fullUrl, num });
                    console.log(`[KJGA]   공지: ${text}`);
                }
            }
            await sleep(300);
        } catch {}
    }

    console.log(`[KJGA] 대회 안내 공지 ${noticeLinks.length}개 발견`);

    // 각 공지 상세 페이지에서 실제 대회 정보 추출
    for (const notice of noticeLinks) {
        try {
            const resp = await http.get(notice.url);
            const $n = cheerio.load(resp.data);
            const body = $n('body').text().replace(/\s+/g, ' ');

            // --- 대회명 추출 ---
            // "제 목" 이후 텍스트에서 추출
            const titleMatch = body.match(/제\s*목\s+(.+?)\s+날\s*짜/);
            let name = titleMatch ? titleMatch[1].trim() : notice.text;
            name = name.replace(/\s*안내\s*$/, '').trim();
            if (shouldExclude(name)) continue;

            // --- 공지 등록일 (참고용) ---
            const postDateMatch = body.match(/날\s*짜\s+(\d{4})-(\d{2})-(\d{2})/);
            const postYear = postDateMatch ? parseInt(postDateMatch[1]) : CURRENT_YEAR;

            // --- 실제 대회 일시 추출 ---
            // 패턴1: "일시 : 4.13(월) ~ 16(목)" → 같은 월 내
            // 패턴2: "일시 : 4.13(월) ~ 5.2(금)" → 다른 월
            let finalsStart = null, finalsEnd = null;

            // 먼저 "일시" 키워드 이후 텍스트 추출
            const ilsiMatch = body.match(/일시\s*[:：]\s*(.+?)(?:\s+장소|\s+신청|\s+자세한|\s+참가)/);
            if (ilsiMatch) {
                const datePart = ilsiMatch[1].trim();

                // "4.13(월) ~ 16(목)" 또는 "4.13(월) ~ 5.16(목)"
                const m1 = datePart.match(/(\d{1,2})\s*[.\-]\s*(\d{1,2})\s*\([가-힣]\)\s*~\s*(?:(\d{1,2})\s*[.\-]\s*)?(\d{1,2})\s*\([가-힣]\)/);
                if (m1) {
                    const startMonth = m1[1].padStart(2, '0');
                    const startDay = m1[2].padStart(2, '0');
                    // m1[3]이 있으면 종료월이 다름, 없으면 시작월과 동일
                    const endMonth = m1[3] ? m1[3].padStart(2, '0') : startMonth;
                    const endDay = m1[4].padStart(2, '0');
                    finalsStart = `${postYear}-${startMonth}-${startDay}`;
                    finalsEnd = `${postYear}-${endMonth}-${endDay}`;
                }

                // "2026. 4. 13 ~ 4. 16" 또는 "2026.04.13~16"
                if (!finalsStart) {
                    const m2 = datePart.match(/(\d{4})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})\s*~\s*(?:(\d{1,2})\s*[.\-]\s*)?(\d{1,2})/);
                    if (m2) {
                        const yr = m2[1];
                        const startMonth = m2[2].padStart(2, '0');
                        const startDay = m2[3].padStart(2, '0');
                        const endMonth = m2[4] ? m2[4].padStart(2, '0') : startMonth;
                        const endDay = m2[5].padStart(2, '0');
                        finalsStart = `${yr}-${startMonth}-${startDay}`;
                        finalsEnd = `${yr}-${endMonth}-${endDay}`;
                    }
                }
            }

            // 대회 일시를 못 찾으면 이 공지는 스킵
            if (!finalsStart) {
                console.log(`[KJGA] 일시 파싱 실패 (스킵): ${name}`);
                continue;
            }

            // --- 신청마감 추출 ---
            // 패턴: "신청마감 : 3.24(화) 16:00까지" 또는 "신청마감 : 3.9(월) 16:00"
            let regEnd = null;
            const regMatch = body.match(/신청마감\s*[:：]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})\s*\([가-힣]\)/);
            if (regMatch) {
                const regMonth = regMatch[1].padStart(2, '0');
                const regDay = regMatch[2].padStart(2, '0');
                regEnd = `${postYear}-${regMonth}-${regDay}`;
            }

            // --- 장소 추출 ---
            // 패턴: "장소 : 무안컨트리클럽" 또는 "장소 : 군산CC"
            let venue = '미정';
            const venueMatch = body.match(/장소\s*[:：]\s*([가-힣A-Za-z0-9\s]+?)(?:\s+신청|\s+참가|\s+자세한|\s+기타|\s*$)/);
            if (venueMatch) {
                venue = venueMatch[1].trim();
            }

            const id = `kjga-${postYear}-${notice.num}`;

            results.push({
                id,
                name,
                association: 'KJGA',
                type: 'student',
                year: parseInt(finalsStart.slice(0, 4)),
                verified: true,
                lastVerified: TODAY,
                dates: {
                    registration: regEnd ? { start: null, end: regEnd } : null,
                    qualification: null,
                    finals: { start: finalsStart, end: finalsEnd },
                    practice: null
                },
                venue,
                categories: ['남자 고등부', '남자 중등부', '여자 고등부', '여자 중등부'],
                url: notice.url
            });

            console.log(`[KJGA] ✓ ${name} | ${finalsStart} ~ ${finalsEnd} | ${venue}`);
            await sleep(300);
        } catch (e) {
            console.log(`[KJGA] 상세 페이지 오류: ${notice.text} - ${e.message}`);
        }
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

        const dateLinePattern = /(\d{2})-(\d{2})(?:~(\d{2}))?\s*[:\s]\s*(.+)/;
        const year = CURRENT_YEAR;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const m = line.match(dateLinePattern);
            if (!m) continue;

            const [, month, startDay, endDay, rest] = m;
            const startDate = `${year}-${month}-${startDay}`;
            const endDate = endDay ? `${year}-${month}-${endDay}` : startDate;

            const nameVenueSplit = rest.split(/[(\（]/);
            const name = nameVenueSplit[0].replace(/\s*:\s*/, '').trim();
            const venueMatch = rest.match(/[(\（]([^)）]+)[)）]/);
            const venue = venueMatch ? venueMatch[1].trim() : '미정';

            if (!name || name.length < 3) continue;

            results.push({
                id: `cn-${year}-${month}${startDay}`,
                name: name,
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
    const custom = existing.filter(t => t.isCustom || t.association === '개인일정');
    const scrapedMap = new Map(scraped.map(t => [t.id, t]));
    const existingMap = new Map(existing.filter(t => !t.isCustom && t.association !== '개인일정').map(t => [t.id, t]));

    // 스크래핑 결과 우선, 기존 것 보완
    const merged = new Map([...existingMap, ...scrapedMap]);

    return [...merged.values(), ...custom];
}

// ============================================================
// 메인 실행
// ============================================================
async function main() {
    console.log('='.repeat(50));
    console.log(`골프 대회 일정 스크래퍼 v2 시작: ${TODAY}`);
    console.log('='.repeat(50));

    let existing = [];
    try {
        existing = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
        console.log(`기존 데이터: ${existing.length}개`);
    } catch {
        console.log('기존 데이터 없음, 새로 생성');
    }

    const allScraped = [];

    // KGA 스크래핑 (올해 ~ 내년까지)
    for (const year of [CURRENT_YEAR, CURRENT_YEAR + 1]) {
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
    const deduped = [...new Map(merged.map(t => [t.id, t])).values()];
    deduped.sort((a, b) => {
        const aDate = a.dates.finals?.start || a.dates.qualification?.start || a.dates.registration?.start || '9999';
        const bDate = b.dates.finals?.start || b.dates.qualification?.start || b.dates.registration?.start || '9999';
        return aDate.localeCompare(bDate);
    });

    fs.writeFileSync(DATA_PATH, JSON.stringify(deduped, null, 2), 'utf-8');

    // 요약 출력
    const kgaCount = deduped.filter(t => t.association === 'KGA').length;
    const kjgaCount = deduped.filter(t => t.association === 'KJGA').length;
    const cnCount = deduped.filter(t => t.association === '충남').length;

    console.log('='.repeat(50));
    console.log(`완료! 총 ${deduped.length}개 대회 저장`);
    console.log(`  KGA: ${kgaCount}개 | KJGA: ${kjgaCount}개 | 충남: ${cnCount}개`);
    console.log(`저장 위치: ${DATA_PATH}`);
    console.log('='.repeat(50));
}

main().catch(e => {
    console.error('스크래퍼 실패:', e);
    process.exit(1);
});
