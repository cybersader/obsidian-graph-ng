// Real Chromium layout of snapshots from the production ExplorePanel constructor.
// No host, plugin installation, network navigation or graph-renderer authority.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const snapshots = JSON.parse(readFileSync(0, 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.setContent('<style>[hidden]{display:none!important}body{--font-ui-small:13px;--font-interface:sans-serif}*{box-sizing:border-box}</style><div class="graph-ng-view"></div>');
  await page.addStyleTag({ content: readFileSync(new URL('../../styles.css', import.meta.url), 'utf8') });
  const rows = [];
  for (const width of [1100, 760, 420, 320, 240]) {
    const positions = [];
    for (const html of snapshots) {
      positions.push(await page.evaluate(({ width, html }) => {
        const root = document.querySelector('.graph-ng-view'); root.style.width = `${width}px`; root.innerHTML = html;
        return root.querySelector('input').getBoundingClientRect().left;
      }, { width, html }));
    }
    rows.push({ width, notes: positions[0], groups: positions[1] });
  }
  console.log(JSON.stringify(rows));
} finally { await browser.close(); }
