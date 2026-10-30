import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DIMENSIONS,
  EXCERPT_CHARS,
  PROMPT_MAX_CHARS,
  SKIPPED_LINT_RULES,
  checkPrompt,
  formatReport,
  isBoundedPattern,
  looksMostlyEnglish,
  matchesInLine,
  patternProblem,
  targetKind,
  type CheckReport,
} from '../src/check.js';
import { CONTRACT, LINT_RULES } from '../src/generated/content.js';
import { TOOL_DESCRIPTIONS } from '../src/server.js';

const STRONG = `# Goal
Write a launch email announcing [[app name]] to existing newsletter subscribers, so that as many as possible start a free trial.

# Context
- The audience is busy professionals who already know the brand.

# Constraints
- Use only the facts above; do not invent numbers.

# Output
- A subject line under 50 characters plus two alternatives.
- Body of 150–250 words.

# If information is missing
If a detail is missing, leave a [[placeholder]] instead of inventing one.`;

const GERMAN =
  'Schreibe einen Blogartikel über Remote-Arbeit für Teamleiter. Länge: etwa 1.200 Wörter. Ton: freundlich. Wenn Informationen fehlen, frage nach.';

const dim = (report: ReturnType<typeof checkPrompt>, name: string) => report.dimensions.find((d) => d.name === name)!;
const found = (report: ReturnType<typeof checkPrompt>, name: string) => dim(report, name).status === 'found';

describe('structure heuristics', () => {
  it('covers exactly the contract score dimensions, in order', () => {
    expect(DIMENSIONS).toEqual(CONTRACT.required.scoreDimensions);
    expect(checkPrompt('x').dimensions.map((d) => d.name)).toEqual([...CONTRACT.required.scoreDimensions]);
  });

  it('finds all five areas in a structured prompt, with evidence', () => {
    const report = checkPrompt(STRONG);
    for (const d of report.dimensions) {
      expect(d.status, d.name).toBe('found');
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.evidence.length).toBeLessThanOrEqual(3);
    }
    expect(dim(report, 'Clear goal').evidence[0]).toBe('# Goal');
    expect(dim(report, 'Edge cases').evidence.join(' ')).toMatch(/missing/);
    expect(report.summary).toMatch(/All five areas/);
  });

  it('reports a rough prompt as a task with little else', () => {
    const report = checkPrompt('write a haiku about rain');
    expect(found(report, 'Clear goal')).toBe(true);
    for (const name of ['Context', 'Constraints', 'Edge cases']) expect(dim(report, name).status, name).toBe('not found');
    expect(report.summary).toMatch(/Not explicitly found: Context/);
  });

  it('finds nothing in a bare topic', () => {
    const report = checkPrompt('remote work');
    expect(report.dimensions.every((d) => d.status === 'not found' && d.evidence.length === 0)).toBe(true);
  });

  it('recognizes XML-tag sections and length limits', () => {
    const report = checkPrompt('<context>\nOur team maintains a billing service.\n</context>\nRespond in 3 bullet points.');
    expect(found(report, 'Context')).toBe(true);
    expect(found(report, 'Output format')).toBe(true);
    expect(found(checkPrompt('Keep it to about 1,200 words.'), 'Output format')).toBe(true);
    expect(found(checkPrompt('Write 150 – 250 words.'), 'Output format')).toBe(true);
  });

  it("doesn't count the prompt's subject as an output format", () => {
    expect(found(checkPrompt('build a JSON parser in rust'), 'Output format')).toBe(false);
    expect(found(checkPrompt('Design a database schema for a library'), 'Output format')).toBe(false);
    expect(found(checkPrompt('Fix this handler:\n```json\n{"id": 1}\n```'), 'Output format')).toBe(false);
    expect(found(checkPrompt('Return the result as valid JSON.'), 'Output format')).toBe(true);
    expect(found(checkPrompt('Respond in JSON.'), 'Output format')).toBe(true);
    expect(found(checkPrompt('Output a JSON object with two keys.'), 'Output format')).toBe(true);
  });

  it('counts common output instructions that name a format', () => {
    for (const prompt of [
      'Your response must be valid JSON.',
      'Make sure your answer is valid JSON.',
      'Extract every person and date from the text. Output: JSON.',
      'JSON only, no prose.',
      'Use this JSON shape: {"name": string, "age": number}',
      'Give the answer in this JSON structure: {"verdict": "...", "reasons": []}',
      'Use JSON for the response.',
      'Respond using JSON.',
      'Respond with nothing but JSON.',
      'Wrap the result in a ```json code block.',
      'Return HTML.',
      'The output must be CSV with a header row.',
      'Your reply is JSON and nothing else.',
      '- YAML only',
    ]) {
      expect(found(checkPrompt(prompt), 'Output format'), prompt).toBe(true);
    }
  });

  it("doesn't count the same format phrases when they describe the task's subject", () => {
    for (const prompt of [
      'Write a GitHub Actions workflow that lints the repo; the config file must be YAML and live in .github.',
      'Add a test that checks the API response is valid JSON before we parse it.',
      'Debug why the build output is HTML with broken links in production.',
      'Our public API accepts JSON only; add a clear 415 error for other content types.',
      'Edit config.json only and leave the other files alone.',
      'The legacy feed sends nothing but XML, so write an adapter for the new service.',
      'The linter run in CI has output: json set, so fix the parser that reads its report.',
      'The mobile app breaks because the server started using JSON for the response body instead of protobuf.',
      'Generate C# classes from this XML schema and add validation.',
      'The payment gateway responds using XML; write a typed Go client for it.',
    ]) {
      expect(found(checkPrompt(prompt), 'Output format'), prompt).toBe(false);
    }
  });

  it('applies image and video conventions for media targets', () => {
    expect(targetKind('Midjourney v7')).toBe('media');
    expect(targetKind('GPT Image')).toBe('media');
    expect(targetKind('Google Veo')).toBe('media');
    expect(targetKind('Claude Code')).toBe('text');
    expect(targetKind('ChatGPT')).toBe('text');
    expect(targetKind(undefined)).toBe('text');

    const prompt = 'a lighthouse keeper repainting stripes at dawn, golden backlight --ar 3:2 --no boats';
    const media = checkPrompt(prompt, 'Midjourney');
    expect(media.targetKind).toBe('media');
    expect(media.target).toBe('Midjourney');
    expect(found(media, 'Output format')).toBe(true);
    expect(found(media, 'Constraints')).toBe(true);
    expect(found(checkPrompt(prompt), 'Output format')).toBe(false);
  });

  it('keeps evidence short', () => {
    const long = `${'Background detail that goes on and on. '.repeat(20)}The audience is managers. ${'More text. '.repeat(20)}`;
    const [snippet] = dim(checkPrompt(long), 'Context').evidence;
    expect(snippet).toBeDefined();
    expect(snippet!.length).toBeLessThanOrEqual(EXCERPT_CHARS + 2);
    expect(snippet).toMatch(/audience/);
  });

  it('collapses runs of whitespace before matching', () => {
    expect(found(checkPrompt('#    Goal\nWrite a post.'), 'Clear goal')).toBe(true);
    expect(dim(checkPrompt('The\taudience   is   managers.'), 'Context').evidence).toEqual(['The audience is managers.']);
  });
});

describe('language', () => {
  it('tells English drafts, including terse image prompts, from other languages', () => {
    for (const english of [
      STRONG,
      'Write a blog post about remote work for team managers, around 1,200 words, friendly tone.',
      'cyberpunk city street, neon signs, rain, reflections, cinematic lighting, 35mm, shallow depth, puddles, crowd, umbrellas, night market, steam',
      'masterpiece, best quality, 1girl, solo, long hair, looking at viewer, smile, outdoors, cherry blossoms, petals, sunlight, depth of field, bokeh',
      // One foreign word, a name, or two accented words doesn't make a terse prompt foreign.
      'Van Gogh style sunflowers in a blue vase, thick impasto, warm light',
      'Los Angeles to Las Vegas road trip montage, desert highway, golden hour, film',
      'Album cover for a Björk-inspired electronic record: Reykjavík at night, aurora, glacier, Sigur Rós mood, minimalist typography',
      'Crème brûlée on a marble counter, soft window light, shallow focus, food photography',
      'Summarize per section, plus key takeaways, max 200 words, bullet points, plain language',
      // English function words outweigh the "os" and "du" of pasted code.
      'Make this work on Windows: for name in os.listdir(home): if os.path.isdir(path) and not name.startswith("."): subprocess.run(["du", "-sh", path])',
      // Accented loanwords, and names after a comma or a number, are no sign of another language.
      'Scandinavian living room, minimalist décor, rosé accents, café table, linen sofa, oak floor, soft daylight, architectural photography, 24mm',
      'Bistro menu design: crème brûlée, café crème, pâté, soufflé, rosé, consommé, flat lay, linen texture, elegant serif, warm light',
      'Wine pairing chart: Château Margaux, Côtes du Rhône, Pouilly-Fumé, Sancerre rosé, Beaujolais nouveau, Crémant, table format, notes per wine',
      'Spain road trip itinerary: day 1 Madrid, day 2 Córdoba, day 3 Málaga, day 4 Cádiz, day 5 Sevilla, budget hotels, kid friendly',
      // Text to render in another script, and Greek letters as symbols.
      'Photorealistic izakaya entrance at dusk, noren curtain printed "居酒屋 鳥よし", paper lanterns, wet cobblestones, 50mm, shallow depth of field',
      'Indian wedding invitation, marigold border, Devanagari heading "शुभ विवाह", gold foil on maroon, elegant, portrait',
      'Museum banner, marble texture, carved Greek inscription "ΓΝΩΘΙ ΣΑΥΤΟΝ", classical columns, dramatic side light, 2:3',
      'Night street in Cairo, glowing shop sign "مخبز السعادة", neon, reflections on wet asphalt, cinematic, anamorphic',
      "Poster with the words '夢を見る' and '東京'",
      'Summarize recent papers on γδ T cells vs αβ T cells in tumor immunity, 300 words, bullet points, cite sources',
      'Compute σ, μ, ρ, τ, ω, λ, φ, θ for the given data',
    ]) {
      expect(looksMostlyEnglish(english), english).toBe(true);
    }
    for (const other of [
      GERMAN,
      "Rédige un article de blog sur le télétravail pour les responsables d'équipe. Longueur : environ 1 200 mots. Ton : amical. Si des informations manquent, pose la question.",
      'Escribe un artículo de blog sobre el teletrabajo para jefes de equipo. Extensión: unas 1.200 palabras. Tono: cercano. Si falta información, pregunta antes de escribir.',
      'Tulis artikel blog tentang kerja jarak jauh untuk manajer tim. Panjang sekitar 1.200 kata dengan nada yang ramah. Jika ada informasi yang kurang, tanyakan dulu sebelum menulis.',
      'チームリーダー向けにリモートワークについてのブログ記事を書いてください。長さは約1200語、口調は親しみやすく。情報が足りない場合は先に質問してください。',
      'Напиши статью для блога об удалённой работе для руководителей команд. Объём: около 1200 слов. Тон: дружелюбный. Если информации не хватает, сначала спроси.',
      // Languages known by their accented letters.
      'Kirjoita blogikirjoitus etätyöstä tiiminvetäjille. Pituus noin 1 200 sanaa. Sävy: ystävällinen. Jos tietoa puuttuu, kysy ensin ennen kuin kirjoitat.',
      'Írj egy blogbejegyzést a távmunkáról csapatvezetőknek. Hossz: körülbelül 1200 szó. Hangnem: barátságos. Ha hiányzik valamilyen információ, előbb kérdezz.',
      'Viết một bài blog về làm việc từ xa dành cho các trưởng nhóm. Độ dài khoảng 1.200 từ. Giọng văn thân thiện. Nếu thiếu thông tin, hãy hỏi trước khi viết.',
      // Short image and video prompts in non-Latin scripts.
      '一只橘猫在窗台上睡觉，水彩风格，柔和光线',
      '창가에서 자는 고양이, 수채화 스타일',
      '夕暮れの海辺を歩く少女、シネマティック',
      // Tool names don't make Japanese, Chinese, Hindi or Russian English, even in a short draft.
      'Next.jsとTypeScriptでブログを作りたいです。Tailwind CSSとPrismaを使い、PostgreSQLに保存し、Vercelにデプロイします。認証はNextAuthでGitHubログイン。テストはVitestとPlaywright。',
      'ChatGPT और Python के लिए प्रॉम्प्ट लिखें',
      'Next.jsとTailwind CSSでLPを作って',
      '用 Python 和 FastAPI 写一个 REST API',
      'Excel में VLOOKUP formula समझाओ',
      'Напиши Dockerfile для Django и PostgreSQL',
      // Devanagari vowel signs count as letters, so this one is more Hindi than Latin.
      'Python में कोड लिखो',
      // Decided by exactly two different function words (10% of the words), by exactly three
      // accented words, and by function words despite one English "The" (under 5% of the words).
      'Retrato de una anciana sonriendo con luz natural suave, fondo desenfocado, colores cálidos, estilo fotografía documental, lente 85mm, alta nitidez',
      'Muotokuva hymyilevästä vanhasta naisesta, pehmeä ja lämmin luonnonvalo, sumea tausta, dokumentaarinen tyyli, objektiivi 85mm',
      'Retrato de una anciana sonriendo con luz natural suave, fondo desenfocado, colores cálidos, estilo fotografía documental, lente 85mm, tipo "The Americans"',
      // A quoted English title or slogan doesn't either.
      "Fasse das Buch 'The Power of Habit' von Charles Duhigg in fünf Stichpunkten zusammen, für Leser ohne Vorwissen.",
      "Escribe tres variantes de un anuncio para Instagram de nuestra marca de café. El eslogan en inglés debe aparecer tal cual: 'Wake up and smell the future'. Tono: cercano. Máximo 40 palabras por variante.",
    ]) {
      expect(looksMostlyEnglish(other), other).toBe(false);
    }
    // Too short to tell: the English checks apply.
    expect(looksMostlyEnglish('Schreibe einen Artikel')).toBe(true);
  });

  it('judges the prose, not code blocks, inline code or URLs', () => {
    const python = Array.from({ length: 20 }, (_, i) => `    total += row[${i}] if row and not row.startswith("#") else 0`).join('\n');
    const chinese = `# 目标\n重构下面的代码，使其更易读、更易测试，行为必须保持不变。\n\n# 约束\n- 不要引入新的依赖。\n- 不要修改公共接口。\n\n# 不确定时\n如果有不清楚的地方，先提问，不要自行假设。`;
    expect(looksMostlyEnglish(`${chinese}\n\n\`\`\`python\n${python}\n\`\`\``), 'Chinese draft with 20 lines of code').toBe(false);
    expect(looksMostlyEnglish('请把 `getUserById` 重命名为 `findUser`，更新 `src/api` 和 `src/web` 里的所有调用。'), 'Chinese with inline code').toBe(false);
    for (const english of [
      'Fix the typo in this file:\n```json\n{ "title": "Guía para el uso de la aplicación", "body": "Para iniciar sesión, introduce tu correo y la contraseña. Si no la recuerdas, pulsa en el enlace de abajo y sigue los pasos." }\n```',
      'Fix this CSS so the cards wrap on small screens:\n```css\n.card { padding: 1em 1.5em; margin: 0.5em auto; font-size: 1.1em; line-height: 1.4em; border-radius: 0.5em; }\n.grid { display: grid; gap: 1em; grid-template-columns: repeat(auto-fill, minmax(18em, 1fr)); }\n```',
      'Check these localized docs links for broken redirects:\nhttps://www.example.com/en/docs/start\nhttps://www.example.com/es/docs/start\nhttps://www.example.com/pt/docs/start\nhttps://www.example.com/fr/docs/start',
    ]) {
      expect(looksMostlyEnglish(english), english).toBe(true);
    }
    // A draft in a text fence is prose, and a code block inside it is still code.
    expect(looksMostlyEnglish(`Here is my draft:\n\`\`\`text\n${GERMAN}\n\`\`\``), 'German draft in a text fence').toBe(false);
    expect(looksMostlyEnglish(`\`\`\`\`text\n${GERMAN}\n\n\`\`\`python\n${python}\n\`\`\`\n\`\`\`\``), 'code block inside a text fence').toBe(false);
    // When nothing but code is left, the code counts.
    expect(looksMostlyEnglish(`\`\`\`\n${GERMAN}\n\`\`\``), 'German draft in a bare fence').toBe(false);
    expect(looksMostlyEnglish('```python\nimport os\nfor name in os.listdir("."):\n    print(name)\n```'), 'only code').toBe(true);
  });

  it('judges the prose outside fences first, and fenced drafts only when that prose is too short', () => {
    const log = [
      'Traceback (most recent call last):',
      '  File "/app/worker.py", line 88, in run',
      '    result = self.handle(job)',
      'httpx.ReadTimeout: The read operation timed out while waiting for the response from the upstream service',
      'ERROR worker: job 4411 failed after 3 retries, giving up; the queue will not retry it again',
    ].join('\n');
    const spanish = 'Refactoriza esta función para que sea más fácil de leer y de probar. No cambies su comportamiento y no añadas dependencias nuevas. Si algo no está claro, pregunta antes de cambiar el código.';
    const chinese = '重构下面的代码，使其更易读、更易测试，行为必须保持不变。不要引入新的依赖，不要修改公共接口。如果有不清楚的地方，先提问，不要自行假设。';
    const python = 'def parse_rows(path):\n    rows = []\n    with open(path) as f:\n        for line in f:\n            if not line.strip() or line.startswith("#"):\n                continue\n            rows.append(line.split(","))\n    return rows';
    const cases: [string, boolean, string][] = [
      // An English log in a text fence, or a ~~~ code block, doesn't make the draft English.
      ['Spanish draft and a log in a text fence', false, `${spanish}\n\nEste es el error:\n\`\`\`text\n${log}\n\`\`\``],
      ['Chinese draft and a log in a txt fence', false, `${chinese}\n\n错误日志：\n\`\`\`txt\n${log}\n\`\`\``],
      ['Chinese draft and code in a ~~~ fence', false, `${chinese}\n\n~~~python\n${python}\n${python}\n${python}\n${python}\n~~~`],
      ['Chinese draft and unfenced code', false, `${chinese}\n\n${python}\n${python}`],
      // A short instruction before a bare-fenced draft: the draft decides.
      ['short German instruction and a German draft in a bare fence', false, `Fasse diesen Text in drei Sätzen zusammen:\n\`\`\`\n${GERMAN}\n${GERMAN}\n\`\`\``],
      ['German draft with a code block in a bare fence', false, `Mein Entwurf:\n\`\`\`\n${GERMAN}\n\`\`\`python\n${python}\n${python}\n\`\`\`\n${GERMAN}\n\`\`\``],
      ['short English instruction and a German draft in a bare fence', false, `Here is my draft:\n\`\`\`\n${GERMAN}\n\`\`\``],
      // ```npm install``` is inline code, not a fence that hides the rest.
      ['German draft with ```code``` at a line start', false, `# Aufgabe\nRichte das Projekt ein.\n\`\`\`npm install\`\`\` ausführen, dann die Tests starten und alle Fehler beheben.\n\n# Kontext\n${GERMAN}`],
      // Inline code doesn't count, and a URL in inline code doesn't swallow the closing backtick and the prose after it.
      ['Spanish one-liner with English words in inline code', false, 'Simplifica la condición `if user and user.is_active and not user.is_banned or the_override` sin cambiar el comportamiento y añade una prueba para cada caso.'],
      ['Spanish one-liner with a URL in inline code', false, 'Revisa por qué `https://staging.ejemplo.com/api/pedidos` devuelve un error 500 cuando el carrito está vacío y propone una solución en `pedidos.ts` sin cambiar la interfaz pública.'],
      // An English instruction long enough to judge decides; a shorter ``` line doesn't close a ```` fence.
      [
        'English instruction and a German README with a code block',
        true,
        `Translate this README into English and keep the code blocks exactly as they are:\n\`\`\`\`markdown\n# Installation\n\`\`\`bash\nnpm install\n\`\`\`\n${GERMAN} ${GERMAN} ${GERMAN}\n\`\`\`\``,
      ],
    ];
    for (const [name, english, draft] of cases) expect(looksMostlyEnglish(draft), name).toBe(english);
  });

  it('recognizes each Latin-script language the check_prompt description names', () => {
    const drafts: Record<string, string> = {
      German: GERMAN,
      French: "Rédige un article de blog sur le télétravail pour les responsables d'équipe. Longueur : environ 1 200 mots. Ton : amical. Si des informations manquent, pose la question.",
      Spanish: 'Escribe un artículo de blog sobre el teletrabajo para jefes de equipo. Extensión: unas 1.200 palabras. Tono: cercano. Si falta información, pregunta antes de escribir.',
      Portuguese: 'Escreva um post de blog sobre trabalho remoto para gestores de equipe. Tamanho: cerca de 1.200 palavras. Tom: amigável. Se faltar informação, pergunte antes.',
      Italian: 'Scrivi un articolo per il blog sul lavoro da remoto per i responsabili di team. Lunghezza: circa 1.200 parole. Tono: cordiale. Se mancano informazioni, chiedi prima.',
      Dutch: 'Schrijf een blogartikel over thuiswerken voor teamleiders. Lengte: ongeveer 1.200 woorden. Toon: vriendelijk. Als er informatie ontbreekt, vraag het dan eerst.',
      Polish: 'Napisz artykuł na bloga o pracy zdalnej dla kierowników zespołów. Długość: około 1200 słów. Ton: przyjazny. Jeśli brakuje informacji, najpierw zapytaj.',
      Swedish: 'Skriv ett blogginlägg om distansarbete för teamledare. Längd: cirka 1 200 ord. Ton: vänlig. Om information saknas, fråga först innan du skriver.',
      Turkish: 'Ekip liderleri için uzaktan çalışma hakkında bir blog yazısı yaz. Uzunluk: yaklaşık 1.200 kelime. Ton: samimi. Bilgi eksikse önce sor.',
      Indonesian: 'Tulis artikel blog tentang kerja jarak jauh untuk manajer tim. Panjang sekitar 1.200 kata dengan nada yang ramah. Jika ada informasi yang kurang, tanyakan dulu sebelum menulis.',
      Tagalog: 'Sumulat ka ng maikling sanaysay tungkol sa kahalagahan ng pagbabasa para sa mga kabataan. Gumamit ng simpleng salita at huwag lumampas sa tatlong daang salita. Kung kulang ang impormasyon, magtanong muna bago magsulat.',
      Swahili: 'Andika makala ya blogu kuhusu kufanya kazi ukiwa mbali kwa ajili ya viongozi wa timu. Urefu: takriban maneno 1,200. Mtindo: wa kirafiki. Ikiwa taarifa fulani haipo, uliza kwanza kabla ya kuandika.',
      'Romanized Hindi': 'Mere startup ke liye ek pitch deck banao jo investors ko impress kare. 10 slides chahiye, simple language mein. Agar koi data missing hai toh placeholder daal do.',
    };
    const description = TOOL_DESCRIPTIONS.check_prompt;
    for (const [language, draft] of Object.entries(drafts)) {
      expect(description, language).toContain(language);
      expect(looksMostlyEnglish(draft), language).toBe(false);
    }
    expect(description).toMatch(/non-Latin scripts/);
    expect(description).toMatch(/accented letters/);
    expect(description).toMatch(/Other languages, and short or terse drafts in any script, may be reported as not found/);
  });

  it('reports areas without a match as unknown in a mostly non-English draft, and still lints it', () => {
    const report = checkPrompt(`${GERMAN}\nVerwende [[Firmenname]] und {{Anrede}}.`);
    expect(report.mostlyEnglish).toBe(false);
    for (const d of report.dimensions) expect(d.status, d.name).toBe('unknown');
    expect(report.summary).toMatch(/mostly non-English/);
    expect(report.summary).toMatch(/unknown: Clear goal, Context, Constraints, Output format, Edge cases/);
    expect(report.issues.map((i) => i.id)).toEqual(['template-leftover', 'open-placeholder']);
    const text = formatReport(report);
    expect(text).toContain('- Clear goal: unknown (keyword checks are English-only)');
    expect(text).not.toMatch(/: not found/);
  });

  it('still reports language-neutral matches as found', () => {
    const report = checkPrompt('ein gemütliches Blockhaus bei Nacht, warmes Licht in den Fenstern, frischer Schnee, Sterne über dem Wald --ar 3:2 --no Menschen', 'Midjourney');
    expect(report.mostlyEnglish).toBe(false);
    expect(dim(report, 'Output format').status).toBe('found');
    expect(dim(report, 'Constraints').status).toBe('found');
    expect(dim(report, 'Edge cases').status).toBe('unknown');
  });

  it('says in the report that the area checks are English-only', () => {
    expect(formatReport(checkPrompt(STRONG))).toMatch(/English keywords and headings only/);
    expect(checkPrompt(STRONG).mostlyEnglish).toBe(true);
  });
});

describe('lint rules', () => {
  it('reports each rule from data/lint-rules.json with id, severity, message, excerpt and line', () => {
    const prompt = [
      'You MUST answer in English.',
      'Think step by step before answering.',
      'Take a deep breath.',
      'Prefill the response with "Sure".',
      'Hello {{ name }}, welcome to [[company name]].',
      'A masterpiece, 8k render.',
    ].join('\n');
    const report = checkPrompt(prompt);
    const ids = report.issues.map((i) => i.id);
    for (const rule of LINT_RULES) expect(ids, rule.id).toContain(rule.id);
    const pressure = report.issues.find((i) => i.id === 'pressure-words')!;
    expect(pressure).toMatchObject({ severity: 'warning', line: 1, excerpt: 'You MUST answer in English.' });
    expect(pressure.message).toBe(LINT_RULES.find((r) => r.id === 'pressure-words')!.message);
    expect(report.issues.find((i) => i.id === 'template-leftover')!.line).toBe(5);
    // Warnings first, then info.
    const firstInfo = report.issues.findIndex((i) => i.severity === 'info');
    expect(report.issues.slice(firstInfo).every((i) => i.severity === 'info')).toBe(true);
  });

  it('is case-sensitive where the rule is (pressure words) and not where it is not', () => {
    expect(checkPrompt('You must answer.').issues.some((i) => i.id === 'pressure-words')).toBe(false);
    expect(checkPrompt('THINK STEP BY STEP').issues.some((i) => i.id === 'visible-reasoning-request')).toBe(true);
  });

  it('reports each distinct match once and caps the list', () => {
    const repeated = checkPrompt('Use [[name]] here and [[name]] there.\n'.repeat(10));
    expect(repeated.issues.filter((i) => i.id === 'open-placeholder')).toHaveLength(1);
    const many = Array.from({ length: 50 }, (_, i) => `[[field ${i}]] MUST NEVER ALWAYS {{v${i}}}`).join('\n');
    const report = checkPrompt(many);
    expect(report.issues.filter((i) => i.id === 'open-placeholder')).toHaveLength(5);
    expect(report.issues.length).toBeLessThanOrEqual(20);
    // A distinct match after many repeats on the same line still counts.
    const oneLine = checkPrompt(`${'[[a]] '.repeat(500)}[[b]]`).issues.filter((i) => i.id === 'open-placeholder');
    expect(oneLine).toHaveLength(2);
    expect(oneLine[1]!.excerpt).toMatch(/\[\[b\]\]$/);
  });

  it('reports nothing for a clean prompt', () => {
    expect(checkPrompt(STRONG.replace(/\[\[[^\]]+\]\]/g, 'Acme')).issues).toEqual([]);
  });

  it('matches one line at a time', () => {
    expect(checkPrompt('{{ name\n}}').issues).toEqual([]);
    expect(checkPrompt('[[company\nname]]').issues).toEqual([]);
  });

  it('runs every rule in data/lint-rules.json: the gate refuses none', () => {
    expect(SKIPPED_LINT_RULES).toEqual([]);
    for (const rule of LINT_RULES) expect(patternProblem(rule.pattern, rule.flags), rule.id).toBeUndefined();
  });
});

describe('lint-rule gate', () => {
  // [pattern, flags]
  type Case = [string, string?];
  const show = ([pattern, flags = '']: Case) => `/${pattern}/${flags}`;

  it('accepts literals, classes, alternation, ? on anything, and bounded repetition of one character or class', () => {
    const cases: Case[] = [
      [String.raw`\b(MUST|NEVER)\b`],
      ['think (really )?hard'],
      ['prefill (the|your|an?) (response|answer)'],
      [String.raw`\{\{[^{}\n]{0,80}\}\}`],
      [String.raw`\[\[[^\[\]\n]{1,120}\]\]`],
      [String.raw`(?:^|\s)--no\s`],
      ['a{3}'],
      ['x{2,5}?'],
      ['[*+]'],
      [String.raw`\*\+`],
      ['(?<name>ab)c'],
      ['(?=a)b'],
      ['(?<=no )TODO'],
      ['(?<!no )TODO'],
      ['{literal}'],
      // As in JavaScript, [^] is any character and [] matches nothing.
      ['[^]{0,10}x'],
      ['x[^]{0,80}'],
      ['[]|x'],
      [String.raw`\p{L}{1,10}`, 'u'],
      [String.raw`\p{Lu}{2,40}`, 'u'],
      [String.raw`[\p{L}--[a-z]]{1,5}`, 'v'],
      // Just within the limits: 1,000 ways to match and 1,000 steps (1 + 9 +
      // 10 x 9 + 100 x 9), and 300 characters looked at.
      ['!x{0,9}y{0,9}z{0,9}'],
      ['a{150}b{150}'],
      [String.raw`\p{L}{150}`, 'u'],
    ];
    for (const c of cases) expect(patternProblem(c[0], c[1]), show(c)).toBeUndefined();
  });

  it('refuses unbounded, repeated-group, oversized and backreferencing patterns, reading [] and [^] as JavaScript does', () => {
    const cases: Case[] = [
      ['a*'],
      ['a+'],
      ['a{2,}'],
      [String.raw`\{\{\s*[\w .-]*\s*\}\}`],
      [String.raw`\[\[[^\]]+\]\]`],
      ['(ab){2}'],
      ['(a|b){0,3}'],
      ['a{0,500}'],
      [String.raw`(a)\1`],
      [String.raw`(?<x>a)\k<x>`],
      [String.raw`\p{L}+`, 'u'],
      // A ] right after [ or [^ closes the class, so the rest is outside it.
      ['[^](a+)+]'],
      ['[](a+)+]'],
      ['[^]*]'],
      ['x[]|z*z*q]'],
      ['[^]a*a*b]'],
      ['you are[^](?:ж+)+]'],
      [String.raw`\[\[[^]*?]]`],
    ];
    for (const c of cases) expect(patternProblem(c[0], c[1]), show(c)).toMatch(/unbounded|repeated group|above 200|backreference/);
  });

  it('refuses patterns that can match the empty string', () => {
    const cases: Case[] = [
      [''],
      ['TODO|', 'u'],
      ['(?:TODO)?', 'u'],
      ['(?:TODO)?', 'v'],
      [String.raw`\b`],
      [String.raw`\B`, 'u'],
      ['^(?:x)?'],
      ['(?=a)'],
      ['x?'],
      ['[^]{0,10}'],
      [String.raw`\p{L}{0,10}`, 'u'],
      [String.raw`\b\p{Lu}{0,20}\b`, 'u'],
      [String.raw`\b(?:a|)\b`, 'iu'],
      [String.raw`\b(masterpiece|best quality|8k|ultra[- ]detailed|award[- ]winning|)\b`, 'iu'],
      // An escape is one character, and so is a surrogate pair under u.
      [String.raw`\u0041?`, 'u'],
      [String.raw`\uD83D\uDE00?`, 'u'],
      [String.raw`\01?`],
      ['😀?', 'u'],
    ];
    for (const c of cases) expect(patternProblem(c[0], c[1]), show(c)).toBe('can match the empty string');
  });

  it('refuses patterns with more than 1,000 ways to match from one position', () => {
    const cases: Case[] = [
      // Repetitions that can match the same characters, side by side.
      [String.raw`\{\{[^}\n]{0,200}[^}\n]{0,200}[^}\n]{0,200}\}\}`],
      ['[^x]{0,200}[^x]{0,200}[^x]{0,200}x'],
      ['a{0,200}a{0,200}!'],
      ['[^x]{0,31}[^x]{0,31}x'],
      ['(?:「)?[ぁ-ゖ]{0,200}[ぁ-ゖ]{0,200}[ぁ-ゖ]{0,200}[。！]'],
      [String.raw`\p{Lu}{2,40} ?\p{Lu}{2,40} ?\p{Lu}{2,40}\b`, 'u'],
      // Optional and alternative groups in a row.
      [`${'(?:a|a)?'.repeat(22)}!`],
      [`${'(?:a|a)'.repeat(24)}b`],
    ];
    for (const c of cases) expect(patternProblem(c[0], c[1]), show(c)).toBe('more than 1000 ways to match from one position');
    expect(isBoundedPattern(String.raw`\bif\b[^.]{0,200}\bthen\b[^.]{0,200}\belse\b[^.]{0,200}\bend\b`, 'i')).toBe(false);
  });

  it('refuses patterns that take more than 1,000 steps to try every way to match from one position', () => {
    const cases: Case[] = [
      // Within 1,000 ways to match and 300 characters, but each way reads far:
      // 9 + 10 x 99 + 1,000 x 180 + 1,000 steps, and the like.
      ['[^x]{0,9}[^x]{0,99}[^x]{180}z'],
      ['[^x]{0,32}[^x]{0,1}[^x]{200}[^x]{60}z'],
      ['a{0,9}a{0,9}a{0,9}a{100}!'],
      [String.raw`\p{Script=Cyrillic}{1,30}\p{Ll}{1,30}\p{L}{80}!`, 'u'],
      // Few characters, but every one of 961 ways to match tries the x.
      ['[^x]{0,30}[^x]{0,30}x'],
      [String.raw`\p{L}{1,30}\p{L}{1,15}!`, 'u'],
      // Alternatives add up their steps: 11 x 100.
      [`(?:${Array.from({ length: 11 }, (_, k) => `${String.fromCharCode(97 + k)}${'x'.repeat(99)}`).join('|')})`],
    ];
    for (const c of cases) expect(patternProblem(c[0], c[1]), show(c)).toBe('more than 1000 steps to try every way to match from one position');
  });

  it('refuses patterns that look at more than 300 characters, which a window may not hold', () => {
    const cases: Case[] = [
      ['a{150}b{151}'],
      [String.raw`\p{L}{151}`, 'u'],
      [String.raw`(?<=[^\n]{200}[^\n]{97})TODO`],
      [String.raw`x(?=[^\n]{200}[^\n]{99}$)`],
      [String.raw`(?<=^[^\n]{200}[^\n]{99})x`],
    ];
    for (const c of cases) expect(patternProblem(c[0], c[1]), show(c)).toBe('looks at more than 300 characters');
  });

  it("refuses invalid patterns and syntax it doesn't read", () => {
    const cases: Case[] = [['[abc'], ['?a'], ['a{2,1}'], ['(?P<x>a)'], ['(?=a)?b'], [String.raw`[\q{abc}]`, 'v'], [String.raw`\p{RGI_Emoji}`, 'v']];
    for (const c of cases) expect(isBoundedPattern(c[0], c[1]), show(c)).toBe(false);
  });
});

describe('long lines', () => {
  // A line over 2,300 characters is matched in windows that each own 2,000
  // characters and see 300 more on either side. These tests put text at the
  // window edges (2,000 and 4,000).
  const lint = (line: string, id: string) => checkPrompt(line).issues.filter((i) => i.id === id);
  // What a scan of the whole line finds: its non-empty matches, as [index, text].
  const wholeLine = (line: string, pattern: RegExp) =>
    [...line.matchAll(pattern)].filter((m) => m[0]).map((m): [number, string] => [m.index, m[0]]);

  it('checks text beyond the first window of a long line, once, with the right line number', () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(200); // about 5,400 characters
    const report = checkPrompt(`intro\n${filler}You MUST fill [[late placeholder]] now. ${filler}`);
    const placeholder = report.issues.filter((i) => i.id === 'open-placeholder');
    expect(placeholder).toHaveLength(1);
    expect(placeholder[0]).toMatchObject({ line: 2 });
    expect(placeholder[0]!.excerpt).toContain('[[late placeholder]]');
    expect(report.issues.filter((i) => i.id === 'pressure-words')).toHaveLength(1);
  });

  it('finds a match that crosses a window edge exactly once', () => {
    for (let shift = 1990; shift <= 2010; shift += 2) {
      const line = `${'x'.repeat(shift)} [[edge case]] ${'y '.repeat(1500)}`;
      expect(lint(line, 'open-placeholder'), `shift ${shift}`).toHaveLength(1);
    }
  });

  it('gives each window the context of the line around it', () => {
    // "Goal:" starts the second window, not the line, so it isn't a heading.
    const midLine = `${'word '.repeat(400)}Goal: something ${'filler '.repeat(100)}`;
    expect(midLine.indexOf('Goal:')).toBe(2_000);
    expect(dim(checkPrompt(midLine), 'Clear goal').evidence).toEqual([]);
    // "MUST" starts the second window, inside a word.
    expect(lint(`${'a '.repeat(999)}aXMUST${' more'.repeat(100)}`, 'pressure-words')).toEqual([]);
    // The first window's text ends after "MUST" in "MUSTARD"; only the second owns it, and sees the whole word.
    expect(lint(`${'a '.repeat(1148)}MUSTARD${' more'.repeat(100)}`, 'pressure-words')).toEqual([]);
  });

  it("doesn't report a match that starts inside the one before it, across a window edge", () => {
    // A scan of the whole line finds "prefill the assistant" and goes on after it.
    const line = `${'x'.repeat(1987)} prefill the assistant turn begins with ${'filler '.repeat(400)}`;
    expect(line.indexOf('assistant')).toBe(2_000);
    expect(lint(line, 'prefill-instruction')).toHaveLength(1);
  });

  it('finds what a scan of the whole line finds, for patterns the gate accepts', () => {
    const E = '😀';
    const patterns: Array<[string, string]> = [
      ['(?<=no )TODO', ''],
      ['(?<!no )TODO', ''],
      [String.raw`(?<=\bno [^\n]{0,100})TODO`, ''],
      [String.raw`\bMUST\b`, ''],
      ['prefill (the|your|an?) (response|answer|reply|assistant)|assistant turn begins with', 'i'],
      [String.raw`BEGIN[^\n]{0,200}END`, ''],
      [String.raw`\[\[[^\[\]\n]{1,120}\]\]`, ''],
      ['END$', ''],
      [String.raw`^\p{Extended_Pictographic}`, 'u'],
      [String.raw`^\P{L}{0,3}TODO`, 'u'],
      [String.raw`\p{Extended_Pictographic}[^\n]{0,140}`, 'u'],
      [String.raw`\p{Lu}{2,40}`, 'u'],
    ];
    const lines = [
      // An emoji whose two halves straddle a window start.
      `${'a'.repeat(1999)}${E}ABC${' def'.repeat(600)}`,
      `${'a'.repeat(3999)}${E} TODO${' def'.repeat(600)}`,
      `${'a'.repeat(1999)}${E}${'b'.repeat(2400)}`,
      // Lookbehind across a window start.
      `${'x'.repeat(1998)}no TODO${' y'.repeat(1500)}`,
      `${'x'.repeat(1997)}no TODO${' y'.repeat(1500)}`,
      `${'x'.repeat(1900)} no ${'z'.repeat(90)} TODO${' y'.repeat(1500)}`,
      // Matches across a window end, at the end of the line, and starting inside another.
      `${'x '.repeat(975)}BEGIN${'z'.repeat(190)}END${' y'.repeat(1500)}`,
      `${'q '.repeat(2000)}END`,
      `${'x'.repeat(1987)} prefill the assistant turn begins with ${'filler '.repeat(400)}`,
      `${'a '.repeat(1148)}MUSTARD${' more'.repeat(100)}`,
      `${'a '.repeat(999)}aXMUST MUST${' more'.repeat(100)}`,
      `${'𝐀'.repeat(1100)} ${'𝐁𝐂 '.repeat(1000)}`,
      ...[1990, 1995, 1999, 2000, 2001, 2005].map((at) => `${'x'.repeat(at)} [[edge case]] ${'y '.repeat(1500)}`),
    ];
    const differences: string[] = [];
    for (const [source, flags] of patterns) {
      expect(patternProblem(source, flags), source).toBeUndefined();
      lines.forEach((line, n) => {
        expect(line.length).toBeGreaterThan(2_300);
        const found = matchesInLine(line, new RegExp(source, `${flags}g`));
        const whole = wholeLine(line, new RegExp(source, `${flags}g`));
        if (JSON.stringify(found) !== JSON.stringify(whole)) differences.push(`/${source}/${flags} on line ${n}: ${JSON.stringify(found)}`);
      });
    }
    expect(differences).toEqual([]);
  });

  it('steps past an empty match by a whole character, so u and v patterns finish on emoji', () => {
    // The gate refuses patterns that can match the empty string, but the loop
    // must still end on them. A loop that steps by one UTF-16 unit never leaves
    // an emoji under u or v, and vitest can't stop a loop that never yields, so
    // the built module runs in a child process with a timeout.
    const checkJs = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'check.js');
    if (!existsSync(checkJs)) throw new Error('dist/check.js is missing; run npm run build (npm test does it for you)');
    const patterns = [
      ['(?:TODO)?', 'u'],
      ['(?:TODO)?', 'v'],
      [String.raw`\b(?:a|)\b`, 'iu'],
      [String.raw`\b\p{Lu}{0,20}\b`, 'u'],
      [String.raw`\B`, 'u'],
      [String.raw`\p{L}{0,10}`, 'u'],
      [String.raw`\b(masterpiece|best quality|8k|ultra[- ]detailed|award[- ]winning|)\b`, 'iu'],
      [String.raw`(?<=\p{Extended_Pictographic})`, 'u'],
    ];
    const lines = ['Great job🎉', 'ok 😀 ok', 'a🚀b', 'Write a launch email 🚀 for our app.', '😀'.repeat(1500), `${'x'.repeat(1999)}😀${' y'.repeat(1500)}`, 'TODO 😀 '.repeat(800)];
    const script = [
      `import { matchesInLine } from ${JSON.stringify(pathToFileURL(checkJs).href)};`,
      'const results = [];',
      `for (const [source, flags] of ${JSON.stringify(patterns)}) for (const line of ${JSON.stringify(lines)}) {`,
      '  const found = matchesInLine(line, new RegExp(source, flags + "g"));',
      '  const whole = [...line.matchAll(new RegExp(source, flags + "g"))].filter((m) => m[0]).map((m) => [m.index, m[0]]);',
      '  results.push(JSON.stringify(found) === JSON.stringify(whole) ? "same" : `/${source}/${flags} differs on ${line.slice(0, 20)}`);',
      '}',
      'console.log(JSON.stringify(results));',
    ].join('\n');
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20_000 });
    expect(run.signal, 'still running after 20 s: an empty match before an emoji never moved on').toBeNull();
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(Array(patterns.length * lines.length).fill('same'));
  });
});

describe('excerpts', () => {
  const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
  const texts = (report: CheckReport) => [...report.issues.map((i) => i.excerpt), ...report.dimensions.flatMap((d) => d.evidence)];
  // The excerpt of a rule's first finding.
  const lint1 = (prompt: string, id: string) => checkPrompt(prompt).issues.find((i) => i.id === id)?.excerpt;

  it('are cut from the whole line, with "…" wherever text was cut', () => {
    // MUST near the start of a later window still gets its left context.
    for (const at of [2_000, 2_010, 4_000]) {
      const line = `${'abcd '.repeat(at / 5)}MUST ${'filler '.repeat(800)}`;
      expect(line.indexOf('MUST')).toBe(at);
      expect(lint1(line, 'pressure-words'), `MUST at ${at}`).toMatch(/^…(abcd ){6}MUST filler.*…$/);
    }
    // ...and in a short last window.
    expect(lint1(`${'a'.repeat(4009)} MUST ${'a'.repeat(35)}`, 'pressure-words')).toMatch(/^…a+ MUST a+$/);
    // Evidence too.
    expect(dim(checkPrompt(`${'a'.repeat(2002)} audience ${'a'.repeat(2990)}`), 'Context').evidence[0]).toMatch(/^…a+ audience a+…$/);
  });

  it('never split a surrogate pair', () => {
    const drafts = [
      `You MUST use them: ${'🚀'.repeat(200)}`,
      `${'🚀'.repeat(100)}xx You MUST ${'a'.repeat(200)}`,
      `Goal: ${'🎉'.repeat(100)}`,
      `Output: one post for Instagram with emoji 😀😃😄😁😆😅😂🤣🥲😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥸🤩🥳 and nothing else\nGoal: write it for our café's launch party ${'🎉'.repeat(60)}`,
      `${'a'.repeat(1999)}🚀 You MUST ${'b '.repeat(1500)}`,
    ];
    for (const draft of drafts) {
      const report = checkPrompt(draft);
      expect(texts(report).length, draft.slice(0, 20)).toBeGreaterThan(0);
      for (const t of texts(report)) expect(LONE_SURROGATE.test(t), JSON.stringify(t)).toBe(false);
      expect(LONE_SURROGATE.test(formatReport(report))).toBe(false);
    }
  });

  it('are well-formed and at most double in length when escaped as JSON, whatever the draft holds', () => {
    // A draft that fills every cap (20 lint findings, 3 evidence items per area)
    // with control characters or unpaired surrogates, most of which JSON writes
    // as six-character escapes; check_prompt returns them as spaces and U+FFFD.
    const capDraft = (u: string) => {
      const run = (n: number) => u.repeat(n);
      let k = 0;
      const tag = () => String.fromCharCode(0x41 + (k++ % 26));
      const around = (word: string) => `${run(39)}${tag()} ${word} ${tag()}${run(120)}`;
      const lines: string[] = [];
      for (const h of ['Goal:', 'Context:', 'Constraints:', 'Output:', 'Edge cases:']) for (let i = 0; i < 3; i++) lines.push(`${h}${tag()}${run(140)}`);
      for (const w of ['MUST', 'NEVER', 'ALWAYS', 'CRITICAL', 'IMPORTANT']) lines.push(around(w));
      for (const w of ['scratchpad', 'Scratchpad', 'sCratchpad', 'scRatchpad', 'scrAtchpad']) lines.push(around(w));
      for (const w of ['prefill an answer', 'Prefill an answer', 'pRefill an answer', 'prEfill an answer', 'preFill an answer']) lines.push(around(w));
      for (let i = 0; i < 5; i++) lines.push(`${run(9)}${tag()}{{${run(79)}${tag()}}}${run(120)}`);
      return lines.join('\n');
    };
    for (const u of ['\u0001', '\u001b', '\u0085', '\ud800', '\udc00']) {
      const report = checkPrompt(capDraft(u), `Claude ${u.repeat(90)}`);
      expect(report.issues.filter((i) => i.severity === 'warning')).toHaveLength(20);
      for (const d of report.dimensions) expect(d.evidence, d.name).toHaveLength(3);
      for (const t of [...texts(report), report.target!]) {
        expect(LONE_SURROGATE.test(t) || CONTROL.test(t), JSON.stringify(t)).toBe(false);
        expect(JSON.stringify(t).length - 2, JSON.stringify(t)).toBeLessThanOrEqual(2 * t.length);
      }
      expect(JSON.stringify(report).length + formatReport(report).length).toBeLessThan(24_000);
    }
  });
});

describe('report', () => {
  it('is deterministic and labelled as a heuristic', () => {
    expect(checkPrompt(STRONG)).toEqual(checkPrompt(STRONG));
    const report = checkPrompt(STRONG);
    expect(report.heuristic).toBe(true);
    expect(report).not.toHaveProperty('score');
    const text = formatReport(report);
    expect(text).toMatch(/heuristic/);
    expect(text).toMatch(/no score/);
    for (const name of CONTRACT.required.scoreDimensions) expect(text).toContain(`- ${name}: found`);
  });

  it('lists each rule message once in the text, then each finding', () => {
    const text = formatReport(checkPrompt('You MUST do it.\nYou NEVER stop.'));
    const message = LINT_RULES.find((r) => r.id === 'pressure-words')!.message;
    expect(text.split(message)).toHaveLength(2);
    expect(text).toContain('    · line 1: "You MUST do it."');
    expect(text).toContain('    · line 2: "You NEVER stop."');
  });

  it('cuts excerpts of long matches and long lines to a fixed length, ending in "…"', () => {
    const report = checkPrompt(`Fill in [[${'customer name and a long description '.repeat(3)}]] ${'and more text '.repeat(5000)}`);
    for (const issue of report.issues) expect(issue.excerpt.length, issue.id).toBeLessThanOrEqual(EXCERPT_CHARS + 2);
    const evidence = report.dimensions.flatMap((d) => d.evidence);
    for (const e of evidence) expect(e.length).toBeLessThanOrEqual(EXCERPT_CHARS + 2);
    const longLine = checkPrompt(`You MUST ${'keep going '.repeat(3000)}`).issues[0]!;
    expect(longLine.excerpt.endsWith('…')).toBe(true);
    expect(longLine.excerpt.length).toBeLessThanOrEqual(EXCERPT_CHARS + 2);
  });

  it('stays small for the largest accepted prompt', () => {
    const line = 'You MUST [[fill]] {{x}} think step by step, masterpiece 8k, audience: managers, if missing ask. ';
    const prompt = line.repeat(Math.floor(PROMPT_MAX_CHARS / line.length)).slice(0, PROMPT_MAX_CHARS);
    const report = checkPrompt(prompt);
    expect(JSON.stringify(report).length + formatReport(report).length).toBeLessThan(24_000);
  });
});

describe('time on adversarial input', () => {
  // Each case is a draft check_prompt accepts: at most PROMPT_MAX_CHARS
  // characters as zod counts them (code points), so the astral cases are up to
  // twice as many UTF-16 units. Each must take less than FACTOR times as long
  // as plain English of the same size, timed in the same run so the limit
  // follows the machine's speed, and FLOOR_MS at least. The shipped code stays
  // well under the limit; the old number signal \d[\d,]* goes well over it on
  // "1," repeated.
  const FACTOR = 50;
  const FLOOR_MS = 50;
  const N = PROMPT_MAX_CHARS;
  const fill = (s: string) => s.repeat(Math.ceil(N / s.length)).slice(0, N);
  const time = (prompt: string, target?: string) => {
    const start = performance.now();
    checkPrompt(prompt, target);
    return performance.now() - start;
  };
  let limitMs = Infinity;
  beforeAll(() => {
    const english = fill('Write a short blog post about remote work for team leads, in a friendly tone. ');
    for (let i = 0; i < 3; i++) time(english);
    const runs = Array.from({ length: 7 }, () => time(english)).sort((a, b) => a - b);
    limitMs = Math.max(FLOOR_MS, FACTOR * runs[3]!);
  });
  const cases: Record<string, string> = {
    '"{{" then spaces': `{{${' '.repeat(N - 2)}`,
    '"{{" then spaces and newlines': `{{${' \n'.repeat(N / 2 - 1)}`,
    '"1," repeated': fill('1,'),
    '"1 - " repeated': fill('1 - '),
    '"[[" repeated': fill('[['),
    '"]]" repeated': fill(']]'),
    'a single-line CSV of numbers': Array.from({ length: N / 5 }, (_, i) => String(1000 + i)).join(',').slice(0, N),
    'long whitespace runs': fill(' \t    x'),
    'one run of spaces': ' '.repeat(N),
    'nested brackets': fill('[[[{{a}}]] '),
    'unbalanced brackets': fill('[[x {{y [[ {{{ ]] }'),
    '"if" and short words': fill('if abc abc abc abc '),
    '"for a" and a long word': `for a ${'x'.repeat(N - 6)}`,
    'heading marks': fill('###### **'),
    'one short line after another': fill('a\n'),
    'every lint rule on one line': fill('You MUST [[fill]] {{x}} think step by step, masterpiece 8k, audience: managers, if missing ask. '),
    'astral letters, one per line': '\u{1D400}\n'.repeat(N / 2),
    'astral letters on one line': '\u{1D400}'.repeat(N),
    'emoji between words': '😀 MUST [[😀]] {{😀}} if 😀 is missing '.repeat(N / 35),
  };

  for (const [name, prompt] of Object.entries(cases)) {
    const chars = [...prompt].length;
    it(`${name} (${chars.toLocaleString('en-US')} characters, ${prompt.length.toLocaleString('en-US')} UTF-16 units)`, () => {
      expect(chars).toBeLessThanOrEqual(N);
      for (const target of [undefined, 'Midjourney']) {
        // The best of three runs, so a pause elsewhere on the machine doesn't count.
        const ms = Math.min(time(prompt, target), time(prompt, target), time(prompt, target));
        expect(ms, `${target ?? 'text'}: ${ms.toFixed(0)} ms, limit ${limitMs.toFixed(0)} ms`).toBeLessThan(limitMs);
      }
    });
  }
});
