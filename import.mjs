import {asciiDigits} from './phone.mjs';

const phonePattern = /(?:\+|00)?\d(?:[ \t().\-–\u00a0]*\d){4,24}/g;
const address = path => new URL('./assets/' + path, import.meta.url).href;

function candidateRows(text, source) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
        const normalized = asciiDigits(line);
        const matches = [...normalized.matchAll(phonePattern)];
        const name = normalized.replace(phonePattern, '').replace(/^[\s,;:|\-]+|[\s,;:|\-]+$/g, '');
        for (const match of matches) {
            rows.push({name, raw: match[0], source});
        }
    }
    return rows;
}

function tables(buffer, file, source) {
    let input = buffer;
    if (/\.(csv|tsv)$/i.test(file.name)) {
        const bytes = new Uint8Array(buffer);
        const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' :
            bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
        input = new TextDecoder(encoding).decode(buffer);
    }
    const book = XLSX.read(input, {type: typeof input === 'string' ? 'string' : 'array', raw: true, cellFormula: false, dense: true});
    return book.SheetNames.map(sheet => ({
        label: source.label + ' / ' + sheet,
        date1904: !!book.Workbook?.WBProps?.date1904,
        rows: XLSX.utils.sheet_to_json(book.Sheets[sheet], {header: 1, raw: true, defval: '', blankrows: false})
    })).filter(table => table.rows.length);
}

function docContent(xml, label) {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    const localName = element => element.nodeName.split(':').at(-1);
    const descendants = (element, name) => Array.from(element.getElementsByTagName('*'))
        .filter(child => localName(child) === name);
    const children = element => Array.from(element.childNodes).filter(child => child.nodeType === 1);
    const paragraph = node => descendants(node, 't').map(t => t.textContent).join('');
    const body = descendants(parsed, 'body')[0];
    const tables = [];
    if (!body) return {text: '', tables};
    const text = children(body).map(element => {
        if (localName(element) === 'p') return paragraph(element);
        if (localName(element) !== 'tbl') return descendants(element, 'p').map(paragraph).join('\n');
        const rows = descendants(element, 'tr').map(row => children(row).filter(cell => localName(cell) === 'tc')
            .map(cell => descendants(cell, 'p').map(paragraph).join(' ')));
        if (rows.some(row => row.length > 1)) {
            tables.push({label: label + ' / جدول ' + (tables.length + 1), rows});
            return '';
        }
        return rows.flat().join('\n');
    }).join('\n');
    return {text, tables};
}

export async function extractFiles(files, progress) {
    let worker;
    const rows = [];
    const reports = [];
    const sheets = [];
    async function recognize(image) {
        worker ??= await Tesseract.createWorker(['ara', 'eng'], 1, {
            workerPath: address('worker.min.js'),
            corePath: address('tesseract-core-lstm.wasm.js'),
            langPath: address(''),
            cacheMethod: 'none'
        });
        return (await worker.recognize(image)).data.text;
    }
    async function fromImage(image, label) {
        const text = await recognize(image);
        rows.push(...candidateRows(text, {label, image, text}));
    }

    try {
        for (const [index, file] of files.entries()) {
            progress(`قراءة الملف ${index + 1} من ${files.length} — ${file.name}`);
            const previous = rows.length + sheets.length;
            const source = {label: file.name};
            try {
                if (file.size > 50 * 1024 * 1024) throw new Error('يتجاوز الملف 50 ميغابايت');
                if (/\.(xlsx|xls|csv|tsv)$/i.test(file.name)) {
                    sheets.push(...tables(await file.arrayBuffer(), file, source));
                } else if (/\.txt$/i.test(file.name)) {
                    const text = await file.text();
                    rows.push(...candidateRows(text, {...source, text}));
                } else if (/\.(png|jpe?g|webp)$/i.test(file.name)) {
                    await fromImage(file, file.name);
                } else if (/\.docx$/i.test(file.name)) {
                    const zip = await JSZip.loadAsync(await file.arrayBuffer());
                    const xml = await zip.file('word/document.xml')?.async('string');
                    if (!xml) throw new Error('ملف Word غير صالح');
                    const {text, tables} = docContent(xml, file.name);
                    sheets.push(...tables);
                    rows.push(...candidateRows(text, {...source, text}));
                    for (const image of Object.values(zip.files).filter(entry => /^word\/media\/.*\.(png|jpe?g|webp|bmp|tiff?)$/i.test(entry.name))) {
                        try {
                            await fromImage(await image.async('blob'), file.name + ' / ' + image.name.split('/').pop());
                        } catch (error) {
                            reports.push(file.name + ' / ' + image.name + ' — ' + error.message);
                        }
                    }
                } else if (/\.pdf$/i.test(file.name)) {
                    const pdfjs = await import('./assets/pdf.min.mjs');
                    pdfjs.GlobalWorkerOptions.workerSrc = address('pdf.worker.min.mjs');
                    const task = pdfjs.getDocument({data: await file.arrayBuffer(), isEvalSupported: false,
                        cMapUrl: address('cmaps/'), cMapPacked: true, standardFontDataUrl: address('standard_fonts/'), wasmUrl: address('wasm/')});
                    try {
                        const pdf = await task.promise;
                        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                            const label = file.name + ' / صفحة ' + pageNumber;
                            progress('قراءة ' + label);
                            const page = await pdf.getPage(pageNumber);
                            const content = await page.getTextContent();
                            let lastY;
                            let text = '';
                            for (const item of content.items) {
                                if (typeof item.str !== 'string') continue;
                                if (text && !text.endsWith('\n') && Math.abs(lastY - item.transform[5]) > 4) text += '\n';
                                text += item.str + (item.hasEOL ? '\n' : ' ');
                                lastY = item.transform[5];
                            }
                            const pageRows = candidateRows(text, {label, text});
                            rows.push(...pageRows);
                            const operators = await page.getOperatorList();
                            const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
                                pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintInlineImageXObjectGroup]);
                            if (!pageRows.length || operators.fnArray.some(op => imageOps.has(op))) {
                                const base = page.getViewport({scale: 1});
                                const viewport = page.getViewport({scale: Math.min(2.5, 2800 / Math.max(base.width, base.height))});
                                const canvas = document.createElement('canvas');
                                canvas.width = Math.ceil(viewport.width);
                                canvas.height = Math.ceil(viewport.height);
                                await page.render({canvas, viewport}).promise;
                                const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                                if (image) await fromImage(image, label + ' / OCR');
                            }
                            page.cleanup();
                        }
                    } finally {
                        await task.destroy();
                    }
                } else {
                    throw new Error('نوع الملف غير مدعوم');
                }
                if (rows.length + sheets.length === previous) reports.push(file.name + ' — لم تُكتشف سجلات');
            } catch (error) {
                reports.push(file.name + ' — ' + (error.message || 'تعذّرت قراءة الملف'));
            }
        }
    } finally {
        if (worker) await worker.terminate();
    }
    return {rows, reports, sheets};
}
