// Видео в уроках LMS ideav.ru/courses: плеер Kinescope (с защитой), YouTube или RuTube — на усмотрение автора.
// Автор ставит ссылку на видео отдельной строкой — в уроке на её месте плеер.
// - в собранном HTML урока лежит не iframe, а метка <div data-video="kinescope:<id>">: санитайзер
//   по-прежнему не пропускает ни одного iframe из текста автора;
// - iframe строит сама страница, адрес — только плеер одного из трёх хостингов; чужой хост и
//   дописанные параметры не проходят;
// - на видео Kinescope — водяной знак зрителя (параметр watermark), чтобы утечку можно было отследить;
//   у YouTube и RuTube водяного знака нет.
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
        ['https://vimeo.com/123456789', 'https://youtube.com/watch?v=short', 'https://www.youtube.com/playlist?list=PLabcdefghijk', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
            'https://rutube.ru/channel/123456/', 'https://rutube.ru.evil.example/video/0123456789abcdef0123456789abcdef/', 'https://rutube.ru/video/XYZ/', 'https://kinescope.io.evil.example/abc123DEF', 'https://evil.example/kinescope.io/abc123DEF',
            'http://kinescope.io/abc123DEF', 'https://kinescope.io/abc123DEF?watermark=x', 'https://kinescope.io/a/b/c'].forEach(u => {
            assert.ok(!AU.md(u).includes('data-video'), u + ' → ' + AU.md(u));
        });
    });

    await t('YouTube: ссылка на ролик в любом обычном виде становится меткой плеера', () => {
        const mark = '<div class="lesson-video" data-video="youtube:dQw4w9WgXcQ"></div>';
        ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ',
            'https://youtu.be/dQw4w9WgXcQ?si=AbCdEf123', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
            '[Смотреть](https://youtu.be/dQw4w9WgXcQ)'].forEach(u => {
            const html = AU.md('До.\n\n' + u + '\n\nПосле.');
            assert.ok(html.includes(mark), u + ' → ' + html);
            assert.ok(!/<a\b/.test(html), u + ': ссылки на месте видео не осталось');
        });
    });

    await t('RuTube: открытый ролик и ролик «по ссылке» (с ключом p) становятся меткой плеера', () => {
        const id = '0123456789abcdef0123456789abcdef';
        ['https://rutube.ru/video/' + id + '/', 'https://rutube.ru/video/' + id, 'https://rutube.ru/play/embed/' + id, 'https://rutube.ru/video/' + id + '/?r=wd'].forEach(u => {
            assert.ok(AU.md(u).includes('<div class="lesson-video" data-video="rutube:' + id + '"></div>'), u + ' → ' + AU.md(u));
        });
        ['https://rutube.ru/video/private/' + id + '/?p=AbC_dEf-123', 'https://rutube.ru/play/embed/' + id + '/?p=AbC_dEf-123', 'https://rutube.ru/video/private/' + id + '/?r=wd&p=AbC_dEf-123'].forEach(u => {
            assert.ok(AU.md(u).includes('<div class="lesson-video" data-video="rutube:' + id + ':AbC_dEf-123"></div>'), u + ' → ' + AU.md(u));
        });
    });

    await t('адреса плееров YouTube и RuTube: без водяного знака и без чужих параметров', () => {
        const id = '0123456789abcdef0123456789abcdef';
        assert.strictEqual(AU.videoSrc('youtube:dQw4w9WgXcQ', 'ivan · 15'), 'https://www.youtube.com/embed/dQw4w9WgXcQ');
        assert.strictEqual(AU.videoSrc('rutube:' + id, 'ivan · 15'), 'https://rutube.ru/play/embed/' + id);
        assert.strictEqual(AU.videoSrc('rutube:' + id + ':AbC_dEf-123', ''), 'https://rutube.ru/play/embed/' + id + '?p=AbC_dEf-123');
        ['youtube:', 'youtube:short', 'youtube:dQw4w9WgXcQ?autoplay=1', 'youtube:dQw4w9WgXcQ/../x', 'rutube:XYZ', 'rutube:' + id + ':', 'rutube:' + id + ':a&b=1', 'rutube:' + id + ':a:b', 'vimeo:123456789']
            .forEach(spec => assert.strictEqual(AU.videoSrc(spec, 'v'), '', spec));
    });

    await t('страница ставит плееры всех трёх хостингов', () => {
        const id = '0123456789abcdef0123456789abcdef';
        const ms = ['kinescope:abc123DEF', 'youtube:dQw4w9WgXcQ', 'rutube:' + id].map(v => node('div', { 'data-video': v }));
        assert.strictEqual(AU.mountVideos(rootWith(ms), 'v'), 3);
        assert.deepStrictEqual(ms.map(m => new URL(m.children[0].attrs.src).host), ['kinescope.io', 'www.youtube.com', 'rutube.ru']);
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
        ['', 'kinescope:', 'kinescope:../x', 'kinescope:abc?x=1', 'kinescope:abc/def', 'tiktok:abc123DEF', 'https://evil.example/', 'kinescope:abc"onload="x', null, undefined]
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
