import { writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const point = (week, day) => [180 + week * 23 - day * 17, 215 + week * 6.3 + day * 11];
const polygon = (points, fill, extra = '') => `<polygon points="${points.map((p) => p.join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
const tile = (w, d, fill) => polygon([point(w, d), point(w + 0.93, d), point(w + 0.93, d + 0.9), point(w, d + 0.9)], fill);

export function readCalendar(payload) {
  if (payload.errors?.length) throw new Error('GitHub GraphQL returned errors; keeping previous forest.');
  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar || !Array.isArray(calendar.weeks) || calendar.weeks.length < 52 || calendar.weeks.length > 54) {
    throw new Error('Expected a full year of contribution weeks.');
  }
  const seen = new Set();
  let previous = null;
  const days = calendar.weeks.flatMap((week, column) => {
    if (!Array.isArray(week.contributionDays) || week.contributionDays.length < 1 || week.contributionDays.length > 7) throw new Error('Invalid week.');
    return week.contributionDays.map((day) => {
      const date = new Date(`${day.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day.date ||
          seen.has(day.date) || !Number.isInteger(day.contributionCount) || day.contributionCount < 0 ||
          !levels.includes(day.contributionLevel) || !Number.isInteger(day.weekday) || day.weekday !== date.getUTCDay() ||
          (day.contributionCount === 0) !== (day.contributionLevel === 'NONE') ||
          (previous !== null && date.getTime() - previous !== 86400000)) throw new Error('Invalid contribution day.');
      seen.add(day.date);
      previous = date.getTime();
      return { ...day, column, level: levels.indexOf(day.contributionLevel) };
    });
  });
  const total = days.reduce((sum, day) => sum + day.contributionCount, 0);
  // GitHub includes the leading partial week around its one-year window.
  if (days.length < 365 || days.length > 372 || !Number.isSafeInteger(calendar.totalContributions) || calendar.totalContributions !== total) {
    throw new Error('Incomplete or inconsistent contribution calendar.');
  }
  return { days, total, columns: calendar.weeks.length };
}

function tree(level, variant) {
  const height = [0, 28, 40, 53, 70][level];
  const radius = [0, 7.2, 9.4, 11.5, 14][level];
  const colors = [[], ['#1e614a', '#30865a', '#4d9b66'], ['#176750', '#298d63', '#62ac74'], ['#187452', '#369b64', '#88bf70'], ['#286d48', '#65a953', '#a1cf70']][level];
  let svg = `<g id="tree-${level}-${variant}"><ellipse cy="2" rx="${radius + 3}" ry="4" fill="#060e10" opacity=".45"/>`;
  svg += polygon([[-1, 0], [-1.3, -height + 5], [1.4, -height + 4], [2, 0]], '#886443');
  svg += `<path d="M0,-${height * 0.48} l-${radius * 0.6},-${height * 0.18} M1,-${height * 0.62} l${radius * 0.6},-${height * 0.12}" stroke="#9d7850" stroke-width="1.3" fill="none"/>`;
  if (level > 2) svg += '<path d="M0,-9 L-4,1 L0,-2 L4,1 L1,-9" fill="#785b3d"/>';
  // Layered broadleaf crowns keep the forest tropical rather than conifer-shaped.
  for (let cluster = 0; cluster < 5; cluster++) {
    const angle = cluster * 2.4 + variant;
    const cx = Math.cos(angle) * radius * (cluster === 0 ? 0 : 0.55);
    const cy = -height + Math.sin(angle) * radius * 0.4 + (cluster === 0 ? -2 : 3);
    const r = radius * (cluster === 0 ? 0.9 : 0.7);
    const ring = Array.from({ length: 7 }, (_, i) => [cx + Math.cos(i * Math.PI * 2 / 7) * r, cy + Math.sin(i * Math.PI * 2 / 7) * r * 0.75]);
    svg += polygon(ring, colors[0]);
    for (let i = 0; i < 7; i++) svg += polygon([[cx - r * 0.2, cy - r * 0.25], ring[i], ring[(i + 1) % 7]], colors[(i + cluster + variant) % 3]);
  }
  return `${svg}</g>`;
}

export function renderForest(calendar, username) {
  const { days, total, columns } = calendar;
  const active = days.filter((day) => day.level > 0).length;
  const max = Math.max(...days.map((day) => day.contributionCount));
  const title = `${username}'s Kalimantan contribution forest`;
  const range = `${days[0].date} — ${days.at(-1).date}`;
  const riverEdge = Array.from({ length: columns + 2 }, (_, w) => point(w - 0.5, 7.7 + Math.sin(w * 0.45) * 0.16));
  const riverBank = Array.from({ length: columns + 2 }, (_, w) => point(w - 0.5, 9.4 + Math.sin(w * 0.4) * 0.25)).reverse();
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="760" viewBox="0 0 1600 760" role="img" aria-labelledby="title desc">
  <title id="title">${escape(title)}</title><desc id="desc">${escape(range)}. ${total} contributions across ${active} active days. One tile per day; larger tropical trees represent higher GitHub contribution levels. A river and a wooden stilt house evoke Kalimantan.</desc>
  <defs><linearGradient id="bg" x2="0.8" y2="1"><stop stop-color="#101c23"/><stop offset="1" stop-color="#0d1117"/></linearGradient><linearGradient id="water"><stop stop-color="#164549"/><stop offset=".5" stop-color="#23777a"/><stop offset="1" stop-color="#163f4a"/></linearGradient>`;
  for (let level = 1; level <= 4; level++) for (let variant = 0; variant < 3; variant++) svg += tree(level, variant);
  svg += '</defs><rect width="1600" height="760" rx="18" fill="url(#bg)"/>';
  svg += `<g font-family="system-ui,Segoe UI,sans-serif"><text x="54" y="51" fill="#aec3c8" font-size="15" letter-spacing="5">${escape(username.toUpperCase())} / CONTRIBUTION FOREST</text><text x="51" y="111" fill="#b1e8c6" font-size="49" font-weight="650">A Year of Growing</text><text x="1545" y="51" fill="#9fb5bb" font-size="16" text-anchor="end">${range}</text><text x="1545" y="88" fill="#b1e8c6" font-size="25" text-anchor="end">${total.toLocaleString('en-US')} contributions</text><text x="1545" y="117" fill="#9fb5bb" font-size="15" text-anchor="end">${active} active days · ${max} on the busiest day</text></g>`;
  svg += polygon([...riverEdge, ...riverBank], 'url(#water)', 'stroke="#2b6262" stroke-width="1"');
  for (let w = 0; w < columns; w++) {
    const [x, y] = point(w, 8.5);
    svg += `<path d="M${x},${y} l12,3 m-6,3 l8,2" stroke="#63a9a5" opacity=".26" stroke-width="1" fill="none"/>`;
  }
  const ground = ['#1b292a', '#203a32', '#224333', '#2b4a35', '#354f36'];
  for (const day of days) svg += `<g><title>${day.date}: ${day.contributionCount} contributions</title>${tile(day.column, day.weekday, ground[day.level])}</g>`;
  for (let w = 0; w < columns; w += 2) {
    const [x, y] = point(w + 0.4, 7.6);
    svg += `<g transform="translate(${x},${y})"><ellipse rx="7" ry="3" fill="#536763"/><path d="M9,2 Q0,-12 2,-12 Q10,-9 9,2 M9,2 Q10,-14 13,-14 Q17,-9 9,2 M9,2 Q20,-7 21,-5 Q22,-1 9,2" fill="#37694e"/><path d="M8,3 L11,-7" stroke="#6d9460" fill="none"/></g>`;
  }
  for (const day of [...days].sort((a, b) => point(a.column, a.weekday)[1] - point(b.column, b.weekday)[1])) {
    const [x, y] = point(day.column + 0.45, day.weekday + 0.45);
    const variant = Number(day.date.replaceAll('-', '')) % 3;
    if (day.level) svg += `<g><title>${day.date}: ${day.contributionCount} contributions</title><use xlink:href="#tree-${day.level}-${variant}" x="${x}" y="${y}"/></g>`;
    else if (variant === 0) svg += `<path d="M${x},${y} l-2,-3 m2,3 l3,-2" stroke="#3a5645" fill="none"/>`;
  }
  const [hx, hy] = point(columns * 0.7, 8.7);
  svg += `<g transform="translate(${hx},${hy})"><path d="M-21,-12 V13 M-5,-7 V19 M24,-15 V7 M9,-1 V19" stroke="#977a57" stroke-width="2"/><path d="M-26,-14 L3,-24 L32,-9 L3,2Z" fill="#947750"/><path d="M-19,-17 V-40 L7,-30 V-6Z" fill="#ad8a5a"/><path d="M7,-30 L24,-40 V-17 L7,-6Z" fill="#6c654e"/><path d="M-26,-40 L-7,-60 L8,-52 L31,-36 L7,-29Z" fill="#b3a17c"/><path d="M-26,-40 L-7,-60 L8,-52 L7,-29Z" fill="#d0b78a"/><path d="M-9,-31 L-3,-29 V-18 L-9,-20Z" fill="#233c3a"/><path d="M13,-29 L19,-33 V-24 L13,-20Z" fill="#213636"/><path d="M-26,-14 L3,2 L32,-9" stroke="#c1a373" fill="none"/></g>`;
  svg += `<g font-family="system-ui,Segoe UI,sans-serif" fill="#9fb5bb"><text x="54" y="690" font-size="15" letter-spacing="4">KALIMANTAN · ${days.length} DAYS OF GROWTH</text><text x="54" y="721" font-size="14">Each tile is a day. Each tree grows with your contributions.</text><text x="1240" y="700" font-size="14">Less</text>`;
  ['#1b292a', '#30865a', '#298d63', '#65a953', '#a1cf70'].forEach((color, i) => {
    const x = 1295 + i * 38;
    svg += polygon([[x, 687], [x + 13, 694], [x, 701], [x - 13, 694]], color);
  });
  return `${svg}<text x="1480" y="700" font-size="14">More</text></g></svg>\n`;
}

export async function generateForest() {
  const username = process.env.GITHUB_USERNAME || 'sizoune';
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) throw new Error('Invalid GitHub username.');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Set GH_TOKEN or GITHUB_TOKEN to read the GitHub contribution calendar.');
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'kalimantan-contribution-forest' },
    body: JSON.stringify({ query: 'query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date weekday contributionCount contributionLevel}}}}}}', variables: { login: username } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}; keeping previous forest.`);
  const calendar = readCalendar(await response.json());
  const svg = renderForest(calendar, username);
  await writeFile('contribution-forest.svg.tmp', svg);
  await rename('contribution-forest.svg.tmp', 'contribution-forest.svg');
  console.log(`Generated ${calendar.days.length} days / ${calendar.total} contributions for ${username}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateForest().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
