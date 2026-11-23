// Преобразования Excel-листа перед универсальным импортом (templates/upload.html), issue #5642.
// Чистые функции без DOM: страница зовёт UploadXlsx.build(), тест — их же через require().
//
// Порядок конвейера для каждого листа:
//   чтение (текстовые колонки, заливка, уровни группировки) → объединённые ячейки →
//   цвет заливки как значение → вырезка диапазона → многострочная шапка → пропуск строк;
// затем склейка листов (имя листа — колонкой «Лист») и разворот колонок-периодов в строки.
//
// Помощники формул (uplFioShort, uplPhone, uplMoney, uplSigned, uplShiftEnd, uplDate,
// uplMonthDate) — глобальные: формулы импорта выполняются через eval() в upload.html.
(function(root){
    'use strict';
    var U={};

    // ── Адреса колонок ──────────────────────────────────────────────────────────
    U.colIndex=function(name){
        var s=String(name||'').trim().toUpperCase(), n=0, i;
        if(!/^[A-Z]+$/.test(s)) return -1;
        for(i=0;i<s.length;i++) n=n*26+(s.charCodeAt(i)-64);
        return n-1;
    };
    // «A, C:F, H» → [0,2,3,4,5,7]; неразборчивые куски пропускаются.
    U.parseCols=function(spec){
        var out=[], seen={};
        String(spec||'').split(/[,;\s]+/).forEach(function(part){
            if(!part) return;
            var m=part.split(/[:\-–]/), a=U.colIndex(m[0]), b=m.length>1?U.colIndex(m[1]):a, i;
            if(a<0||b<0) return;
            if(a>b){ i=a; a=b; b=i; }
            for(i=a;i<=b;i++) if(!seen[i]){ seen[i]=1; out.push(i); }
        });
        return out.sort(function(x,y){ return x-y; });
    };
    U.parseWords=function(spec){
        return String(spec||'').split(/[,;]+/).map(function(w){ return w.trim(); }).filter(Boolean);
    };

    // ── Значение ячейки «текст как есть» ────────────────────────────────────────
    // Число без экспоненты и округления формата (штрихкод 4600000000000, а не 4.6E+12);
    // ведущие нули из формата ячейки («00123») сохраняются; строка — как записана.
    U.rawText=function(cell){
        if(!cell) return '';
        if(cell.t==='s'||cell.t==='str') return String(cell.v==null?'':cell.v);
        if(cell.t==='n'){
            if(cell.w&&/^0\d+$/.test(cell.w)) return cell.w;
            var v=cell.v;
            if(typeof v!=='number'||!isFinite(v)) return String(v==null?'':v);
            if(Number.isInteger(v)&&typeof BigInt==='function') return BigInt(v).toString();
            return String(v);
        }
        if(cell.t==='b') return cell.v?'1':'0';
        return cell.w!=null?String(cell.w):String(cell.v==null?'':cell.v);
    };

    // Ключ цвета заливки ячейки: «RRGGBB» или «theme:N[:tint]»; '' — без заливки.
    U.fillKey=function(cell){
        var s=cell&&cell.s;
        if(!s||!s.patternType||s.patternType==='none') return '';
        var c=s.fgColor||{};
        if(c.rgb) return String(c.rgb).toUpperCase().replace(/^([0-9A-F]{2})([0-9A-F]{6})$/,'$2');
        if(c.theme!=null) return 'theme:'+c.theme+(c.tint?':'+Number(c.tint).toFixed(2):'');
        if(c.indexed!=null) return 'indexed:'+c.indexed;
        return '';
    };

    // ── Чтение листа ────────────────────────────────────────────────────────────
    // Буквы колонок (textCols, emptyCol, unpivot) — как в сетке страницы: A = первая колонка !ref.
    // rows — ровно то, что даёт sheet_to_json(header:1, raw:false, defval:''), выровненное
    // по ширине; fills/levels/merges — в тех же координатах (0,0 = левый верхний угол !ref).
    U.readSheet=function(XLSX, ws, opts){
        opts=opts||{};
        var rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''});
        var maxC=0; rows.forEach(function(r){ if(r.length>maxC) maxC=r.length; });
        rows.forEach(function(r){ while(r.length<maxC) r.push(''); });
        var org=ws&&ws['!ref']?XLSX.utils.decode_range(ws['!ref']).s:{r:0,c:0};
        var textCols=opts.textCols||[], fills=[], levels=[], hasFill=false, i, j, k, cell;
        for(i=0;i<rows.length;i++){
            for(k=0;k<textCols.length;k++){
                j=textCols[k];
                if(j<0||j>=maxC) continue;
                cell=ws[XLSX.utils.encode_cell({r:org.r+i,c:org.c+j})];
                if(cell&&cell.t!=='z') rows[i][j]=U.rawText(cell);
            }
            fills[i]=[];
            for(j=0;j<maxC;j++){
                cell=ws[XLSX.utils.encode_cell({r:org.r+i,c:org.c+j})];
                fills[i][j]=U.fillKey(cell);
                if(fills[i][j]) hasFill=true;
            }
            var ri=ws['!rows']&&ws['!rows'][org.r+i];
            levels[i]=ri&&ri.level?ri.level:0;
        }
        var merges=(ws['!merges']||[]).map(function(m){
            return {s:{r:m.s.r-org.r,c:m.s.c-org.c},e:{r:m.e.r-org.r,c:m.e.c-org.c}};
        });
        return {rows:rows, fills:fills, levels:levels, merges:merges, hasFill:hasFill, origin:org};
    };

    // Значение (и заливку) левой верхней клетки объединения — на весь диапазон.
    // rowFilter(r) — какие строки заполнять (по умолчанию все).
    U.fillMerges=function(sheet, rowFilter){
        sheet.merges.forEach(function(m){
            var v=sheet.rows[m.s.r]&&sheet.rows[m.s.r][m.s.c];
            var f=sheet.fills[m.s.r]&&sheet.fills[m.s.r][m.s.c];
            for(var r=m.s.r;r<=m.e.r;r++){
                if(!sheet.rows[r]||(rowFilter&&!rowFilter(r))) continue;
                for(var c=m.s.c;c<=m.e.c;c++){
                    if(c>=sheet.rows[r].length) continue;
                    sheet.rows[r][c]=v;
                    if(sheet.fills[r]) sheet.fills[r][c]=f;
                }
            }
        });
        return sheet;
    };

    // Различные цвета заливки листа с числом клеток — для таблицы сопоставления.
    U.listFills=function(sheet){
        var cnt={}, order=[];
        sheet.fills.forEach(function(row){ row.forEach(function(k){
            if(!k) return;
            if(!cnt[k]){ cnt[k]=0; order.push(k); }
            cnt[k]++;
        }); });
        return order.map(function(k){ return {key:k,count:cnt[k]}; });
    };

    // Цвет → значение справочника. mode 'empty' — только в пустые клетки, 'all' — во все.
    U.applyFills=function(sheet, map, mode){
        if(!map) return sheet;
        sheet.rows.forEach(function(row,r){ row.forEach(function(v,c){
            var k=sheet.fills[r]&&sheet.fills[r][c], to=k&&map[k];
            if(to===undefined||to===null||to==='') return;
            if(mode==='all'||String(v).trim()==='') row[c]=to;
        }); });
        return sheet;
    };

    // Склейка шапки из n строк: «Январь / План» → «Январь План» (повтор подряд не дублируется).
    U.combineHeader=function(rows, n){
        if(!(n>1)||!rows.length) return rows;
        n=Math.min(n,rows.length);
        var width=rows[0].length, head=[], c, r, parts, s;
        for(c=0;c<width;c++){
            parts=[];
            for(r=0;r<n;r++){
                s=String(rows[r][c]==null?'':rows[r][c]).trim();
                if(s!==''&&parts[parts.length-1]!==s) parts.push(s);
            }
            head.push(parts.join(' '));
        }
        return [head].concat(rows.slice(n));
    };

    // Пропуск служебных строк данных: rule = {words:[…], emptyCol:j|-1, deepest:bool}.
    // words — ячейка начинается с отдельного слова («Итого», но не «Итоговая»);
    // emptyCol — пустая ключевая колонка (индекс внутри диапазона);
    // deepest — оставить только строки наибольшего уровня группировки (подытоги 1С выше).
    U.skipRowsFilter=function(rows, levels, rule){
        rule=rule||{};
        var res=(rule.words||[]).map(function(w){
            return new RegExp('^'+w.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')+'(?![0-9A-Za-zА-Яа-яЁё])','i');
        });
        var maxLevel=0, i;
        if(rule.deepest) for(i=0;i<levels.length;i++) if(levels[i]>maxLevel) maxLevel=levels[i];
        return rows.map(function(row,i){
            if(rule.emptyCol>=0&&String(row[rule.emptyCol]==null?'':row[rule.emptyCol]).trim()==='') return false;
            if(maxLevel>0&&(levels[i]||0)<maxLevel) return false;
            for(var k=0;k<res.length;k++)
                for(var c=0;c<row.length;c++)
                    if(res[k].test(String(row[c]==null?'':row[c]).trim())) return false;
            return true;
        });
    };

    // Разворот «периоды в колонках» в строки: остальные колонки + «Период» + «Значение».
    // cols — индексы колонок-периодов внутри таблицы; период — заголовок колонки
    // (без шапки — буква колонки листа, colName(j)).
    U.unpivot=function(header, data, cols, opts){
        opts=opts||{};
        var isP={}, keep=[], i;
        cols.forEach(function(c){ isP[c]=1; });
        var width=header?header.length:(data[0]?data[0].length:0);
        for(i=0;i<width;i++) if(!isP[i]) keep.push(i);
        var pcols=cols.filter(function(c){ return c<width; });
        var outHead=header?keep.map(function(c){ return header[c]; }).concat([opts.periodName||'Период',opts.valueName||'Значение']):null;
        var out=[];
        data.forEach(function(row){
            var base=keep.map(function(c){ return row[c]; });
            pcols.forEach(function(c){
                var v=row[c];
                if(opts.skipEmpty!==false&&String(v==null?'':v).trim()==='') return;
                var p=header?header[c]:(opts.colName?opts.colName(c):String(c));
                out.push(base.concat([p,v]));
            });
        });
        return {header:outHead, data:out};
    };

    // ── Полный конвейер ─────────────────────────────────────────────────────────
    // sheets — имена листов; sel = {r0,c0,r1,c1} (r1/c1 null — до края; на каждом листе
    // ограничиваются его размером); hasHeader — первая строка диапазона = шапка.
    // opts: {fillMerges, headerRows, textCols:'A,C', skip:{words,emptyCol:'B',deepest},
    //        colors:{RRGGBB:'значение'}, colorMode, allSheets, unpivot:'D:AH', unpivotKeepEmpty}
    // Возвращает {rows, errors}: rows — таблица (с шапкой, если hasHeader) без пустых строк.
    U.build=function(XLSX, wb, sheetName, sel, opts, hasHeader){
        opts=opts||{};
        var names=opts.allSheets?wb.SheetNames.slice():[sheetName];
        var textCols=U.parseCols(opts.textCols);
        var hdrN=hasHeader?Math.max(1,parseInt(opts.headerRows,10)||1):0;
        var skipCol=opts.skip&&opts.skip.emptyCol?U.colIndex(opts.skip.emptyCol):-1;
        var pivot=U.parseCols(opts.unpivot);
        var header=null, data=[], c0=sel.c0|0;
        names.forEach(function(name, si){
            var ws=wb.Sheets[name];
            if(!ws||!ws['!ref']) return;
            var sh=U.readSheet(XLSX, ws, {textCols:textCols});
            if(!sh.rows.length) return;
            var r0=Math.min(sel.r0|0, sh.rows.length-1);
            var eR=sel.r1==null?sh.rows.length-1:Math.min(sel.r1, sh.rows.length-1);
            var eC=sel.c1==null?sh.rows[0].length-1:Math.min(sel.c1, sh.rows[0].length-1);
            // при шапке в 2+ строки её объединения разносятся всегда (иначе склейка «Неделя 1 / 2» теряет «Неделя 1»)
            if(opts.fillMerges) U.fillMerges(sh);
            else if(hdrN>1) U.fillMerges(sh, function(r){ return r>=r0&&r<r0+hdrN; });
            if(opts.colors) U.applyFills(sh, opts.colors, opts.colorMode);
            var rows=[], lev=[], r, c, row;
            for(r=r0;r<=eR;r++){
                row=[];
                for(c=c0;c<=eC;c++) row.push(sh.rows[r]&&sh.rows[r][c]!==undefined?sh.rows[r][c]:'');
                rows.push(row); lev.push(sh.levels[r]||0);
            }
            var head=null;
            if(hdrN){
                var comb=U.combineHeader(rows, hdrN);
                head=comb[0]; rows=comb.slice(1); lev=lev.slice(Math.min(hdrN,lev.length));
            }
            if(opts.skip){
                var keep=U.skipRowsFilter(rows, lev, {words:U.parseWords(opts.skip.words), emptyCol:skipCol>=0?skipCol-c0:-1, deepest:!!opts.skip.deepest});
                rows=rows.filter(function(x,i){ return keep[i]; });
            }
            if(opts.allSheets){
                if(head) head=head.concat(['Лист']);
                rows=rows.map(function(x){ return x.concat([name]); });
            }
            if(header===null&&head) header=head;
            data=data.concat(rows);
        });
        data=data.filter(function(row){ return row.some(function(v){ return String(v==null?'':v).trim()!==''; }); });
        if(pivot.length){
            var abs=sel.c0|0, rel=pivot.map(function(c){ return c-abs; }).filter(function(c){ return c>=0; });
            var up=U.unpivot(header, data, rel, {skipEmpty:!opts.unpivotKeepEmpty, colName:function(j){ return U.colName(j+abs); }});
            header=up.header; data=up.data;
        }
        return {rows:(header?[header]:[]).concat(data)};
    };
    U.colName=function(n){ var s=''; n++; while(n>0){ var m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; };

    // ── Помощники формул импорта (п. 8) ─────────────────────────────────────────
    function pad2(n){ return (n<10?'0':'')+n; }
    function fmtDate(d){ return pad2(d.getDate())+'.'+pad2(d.getMonth()+1)+'.'+d.getFullYear(); }
    // «Иванов Иван Иванович» → «Иванов И.И.»; уже краткая форма — без изменений.
    function uplFioShort(s){
        var p=String(s||'').trim().split(/\s+/).filter(Boolean);
        if(p.length<2) return p.join(' ');
        return p[0]+' '+p.slice(1).map(function(w){ return w.replace(/\.+$/,'').split('.').map(function(x){ return x?x.charAt(0).toUpperCase()+'.':''; }).join(''); }).join('');
    }
    // Телефон в E.164; российские 8XXXXXXXXXX / XXXXXXXXXX → +7XXXXXXXXXX.
    function uplPhone(s){
        var raw=String(s||'').trim(), d=raw.replace(/\D/g,'');
        if(!d) return '';
        if(d.length===11&&(d.charAt(0)==='8'||d.charAt(0)==='7')) return '+7'+d.slice(1);
        if(d.length===10) return '+7'+d;
        return '+'+d;
    }
    // «1 234 567,89 руб.», «(1 000)», «-12'500.5» → число (строкой с точкой); пусто → ''.
    function uplMoney(s){
        var t=String(s==null?'':s).replace(/[\s  ']/g,'');
        if(t==='') return '';
        var neg=/^\(.*\)$/.test(t)||/^-/.test(t);
        t=t.replace(/[^0-9,.]/g,'').replace(/^[.,]+|[.,]+$/g,'');
        if(t==='') return '';
        var lc=t.lastIndexOf(','), ld=t.lastIndexOf('.');
        if(lc>ld) t=t.replace(/\./g,'').replace(',','.');
        else t=t.replace(/,/g,'');
        var n=parseFloat(t);
        if(isNaN(n)) return '';
        return String(neg?-n:n);
    }
    // Дебет/кредит из двух колонок → одна сумма со знаком (дебет − кредит).
    function uplSigned(debit, credit){
        var d=parseFloat(uplMoney(debit))||0, c=parseFloat(uplMoney(credit))||0;
        return String(Math.round((d-c)*100)/100);
    }
    function parseDate(s){
        if(s instanceof Date) return new Date(s.getTime());
        var t=String(s||'').trim(), m;
        if((m=t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/))) return new Date(+(m[3].length===2?'20'+m[3]:m[3]), m[2]-1, +m[1]);
        if((m=t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], m[2]-1, +m[3]);
        if((m=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return new Date(+(m[3].length===2?'20'+m[3]:m[3]), m[1]-1, +m[2]);
        return null;
    }
    function parseTime(s){
        var m=String(s||'').trim().match(/(\d{1,2})[:.](\d{2})/);
        return m?{h:+m[1],m:+m[2]}:null;
    }
    // Конец смены через полночь: дата, начало, конец → «ДД.ММ.ГГГГ ЧЧ:ММ» конца
    // (конец раньше начала → следующий день).
    function uplShiftEnd(date, start, end){
        var d=parseDate(date), a=parseTime(start), b=parseTime(end);
        if(!d||!b) return '';
        if(a&&(b.h*60+b.m)<(a.h*60+a.m)) d.setDate(d.getDate()+1);
        return fmtDate(d)+' '+pad2(b.h)+':'+pad2(b.m);
    }
    var MONTHS=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];
    function monthIndex(s){
        var t=String(s||'').trim().toLowerCase();
        if(/^\d{1,2}$/.test(t)) return +t-1;
        for(var i=MONTHS.length-1;i>=0;i--) if(t.indexOf(MONTHS[i])===0&&(i!==4||/^ма[йяе]/.test(t))) return i;
        return -1;
    }
    // День месяца (заголовок колонки-периода) → «ДД.ММ.ГГГГ»; месяц — номер или название.
    function uplDate(day, month, year){
        var m=monthIndex(month), d=parseInt(day,10), y=parseInt(year,10);
        if(m<0||!(d>=1&&d<=31)||!(y>0)) return '';
        var dt=new Date(y,m,d);
        return dt.getMonth()===m?fmtDate(dt):'';
    }
    // «Январь 2026», «янв.26», «01.2026» → «01.01.2026».
    function uplMonthDate(s){
        var t=String(s||'').trim(), m=t.match(/^(\d{1,2})[.\/](\d{2,4})$/), y, mi;
        if(m){ mi=+m[1]-1; y=+m[2]; }
        else{
            m=t.match(/^([A-Za-zА-Яа-яЁё]+)\.?\s*(\d{2,4})$/);
            if(!m) return '';
            mi=monthIndex(m[1]); y=+m[2];
        }
        if(y<100) y+=2000;
        if(!(mi>=0&&mi<12)) return '';
        return fmtDate(new Date(y,mi,1));
    }
    U.helpers={uplFioShort:uplFioShort, uplPhone:uplPhone, uplMoney:uplMoney, uplSigned:uplSigned,
               uplShiftEnd:uplShiftEnd, uplDate:uplDate, uplMonthDate:uplMonthDate};
    // Шаблоны для выпадающего списка у поля формулы: [Поле] заменяется именем выбранного поля.
    U.formulaTemplates=[
        {name:'ФИО → Фамилия И.О.', f:"uplFioShort('[Поле]')"},
        {name:'Телефон → +7XXXXXXXXXX (E.164)', f:"uplPhone('[Поле]')"},
        {name:'Сумма «1 234,56» → 1234.56', f:"uplMoney('[Поле]')"},
        {name:'Дебет и кредит → сумма со знаком', f:"uplSigned('[Дебет]','[Кредит]')"},
        {name:'Конец смены через полночь', f:"uplShiftEnd('[Дата]','[Начало]','[Конец]')"},
        {name:'День месяца → дата', f:"uplDate('[Поле]','11','2026')"},
        {name:'«Январь 2026» → 01.01.2026', f:"uplMonthDate('[Поле]')"}
    ];

    root.UploadXlsx=U;
    for(var h in U.helpers) root[h]=U.helpers[h];
    if(typeof module!=='undefined'&&module.exports) module.exports=U;
})(typeof window!=='undefined'?window:this);
