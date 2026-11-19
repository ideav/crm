// Видео в уроках LMS ideav.ru/courses: плеер внешнего видеохостинга с защитой (Kinescope).
// Автор ставит ссылку на видео отдельной строкой — в уроке на её месте плеер.
// - в собранном HTML урока лежит не iframe, а метка <div data-video="kinescope:<id>">: санитайзер
//   по-прежнему не пропускает ни одного iframe из текста автора;
// - iframe строит сама страница, адрес — только https://kinescope.io/embed/<id>, чужой хост и
//   дописанные к id параметры не проходят;
// - на видео — водяной знак зрителя (параметр watermark), чтобы утечку можно было отследить.
//
// Run with: node experiments/courses-video-embed.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const dir = path.join(__dirname, '..', 'download', 'courses', 'js');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// Узел поддельного DOM: хватает для AU.mountVideos (атрибуты, дети, поиск меток).
function node(tag, attrs) {
    return {
        tagName: String(tag).toUpperCase(), attrs: Object.assign({}, attrs), children: [], className: '',
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        removeAttribute(k) { delete this.attrs[k]; },
        appendChild(c) { this.children.push(c); return c; },
    };
}
function rootWith(marks) {
    return { querySelectorAll(sel) { assert.strictEqual(sel, '[data-video]'); return marks; } };
}

const ctx = { console, document: { createElement: tag => node(tag) } };
ctx.window = ctx;
ctx.DOMPurify = {
    addHook() {},
    // заглушка как в courses-authors-93: настоящий DOMPurify в node без DOM не работает
    sanitize(html) { return String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<iframe[\s\S]*?(<\/iframe>|$)/gi, '').replace(/\son\w+="[^"]*"/gi, ''); },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'vendor', 'marked-18.0.5.umd.js'), 'utf8'), ctx);
ctx.LMSApp = { sha256: s => Promise.resolve(sha(s)) };
vm.runInContext(fs.readFileSync(path.join(dir, 'authors.js'), 'utf8'), ctx);
const AU = ctx.LMSApp.au;

const MARK = id => '<div class="lesson-video" data-video="kinescope:' + id + '"></div>';
let failed = 0;
async function t(name, fn) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

(async () => {
    await t('ссылка на видео отдельной строкой становится меткой плеера', () => {
        const html = AU.md('Вступление.\n\nhttps://kinescope.io/2ByU6Ye8bR1mZp\n\nПосле видео.');
        assert.ok(html.includes(MARK('2ByU6Ye8bR1mZp')), html);
        assert.ok(!/<a\b/.test(html), 'ссылки на месте видео не осталось: ' + html);
        assert.ok(html.includes('Вступление.') && html.includes('После видео.'));
    });

    await t('адрес встраивания /embed/<id> и ссылка с подписью тоже дают плеер', () => {
        assert.ok(AU.md('https://kinescope.io/embed/abc123DEF').includes(MARK('abc123DEF')));
        assert.ok(AU.md('[Смотреть урок](https://kinescope.io/abc123DEF)').includes(MARK('abc123DEF')));
    });

    await t('ссылка внутри предложения остаётся ссылкой', () => {
        const html = AU.md('Запись лежит тут: https://kinescope.io/abc123DEF — посмотрите.');
        assert.ok(!html.includes('data-video'), html);
        assert.ok(/<a [^>]*href="https:\/\/kinescope\.io\/abc123DEF"/.test(html), html);
    });

    await t('чужой хост и похожий домен плеером не становятся', () => {
        ['https://youtube.com/watch?v=abc123DEF', 'https://kinescope.io.evil.example/abc123DEF', 'https://evil.example/kinescope.io/abc123DEF',
            'http://kinescope.io/abc123DEF', 'https://kinescope.io/abc123DEF?watermark=x', 'https://kinescope.io/a/b/c'].forEach(u => {
            assert.ok(!AU.md(u).includes('data-video'), u + ' → ' + AU.md(u));
        });
    });

    await t('iframe из текста автора в урок не попадает', () => {
        const html = AU.md('<iframe src="https://kinescope.io/embed/abc123DEF"></iframe>\n\nтекст');
        assert.ok(!/<iframe/i.test(html), html);
    });

    await t('адрес плеера: только kinescope.io/embed/<id>, зритель — в водяном знаке', () => {
        assert.strictEqual(AU.videoSrc('kinescope:abc123DEF', ''), 'https://kinescope.io/embed/abc123DEF');
        const u = AU.videoSrc('kinescope:abc123DEF', 'ivan@example.com · 217874');
        assert.strictEqual(u, 'https://kinescope.io/embed/abc123DEF?watermark=' + encodeURIComponent('ivan@example.com · 217874'));
        const wm = new URL(u).searchParams;
        assert.deepStrictEqual([...wm.keys()], ['watermark'], 'зритель не может дописать свой параметр');
        assert.strictEqual(new URL(AU.videoSrc('kinescope:abc123DEF', 'x&autoplay=1#y')).searchParams.get('watermark'), 'x&autoplay=1#y');
    });

    await t('испорченная метка адреса не даёт', () => {
        ['', 'kinescope:', 'kinescope:../x', 'kinescope:abc?x=1', 'kinescope:abc/def', 'youtube:abc123DEF', 'https://evil.example/', 'kinescope:abc"onload="x', null, undefined]
            .forEach(spec => assert.strictEqual(AU.videoSrc(spec, 'v'), '', String(spec)));
    });

    await t('страница ставит iframe в метку, а испорченную метку оставляет пустой', () => {
        const good = node('div', { 'data-video': 'kinescope:abc123DEF' });
        const bad = node('div', { 'data-video': 'kinescope:abc"><script>' });
        assert.strictEqual(AU.mountVideos(rootWith([good, bad]), 'Иван · 15'), 1);
        assert.strictEqual(good.children.length, 1);
        const f = good.children[0];
        assert.strictEqual(f.tagName, 'IFRAME');
        assert.strictEqual(f.attrs.src, 'https://kinescope.io/embed/abc123DEF?watermark=' + encodeURIComponent('Иван · 15'));
        assert.ok('allowfullscreen' in f.attrs);
        assert.ok(/encrypted-media/.test(f.attrs.allow), 'защищённое видео (DRM) без encrypted-media не играет');
        assert.strictEqual(bad.children.length, 0);
    });

    await t('повторный вызов второй плеер в ту же метку не ставит', () => {
        const m = node('div', { 'data-video': 'kinescope:abc123DEF' });
        AU.mountVideos(rootWith([m]), 'v');
        AU.mountVideos(rootWith([m]), 'v');
        assert.strictEqual(m.children.length, 1);
    });

    await t('опубликованный урок несёт метку и переживает повторную очистку при показе', async () => {
        const l = await AU.buildLesson({ id: 'l7', course: 'a5', n: 1, title: 'Видео', md: 'https://kinescope.io/abc123DEF', tasks: [] });
        assert.ok(l.html.includes(MARK('abc123DEF')), l.html);
        assert.ok(AU.cleanLesson(l).html.includes(MARK('abc123DEF')));
    });

    if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
    console.log('\nall passed');
})();
