// ==UserScript==
// @name         问卷星AI做题
// @description  问卷星AI自动填写，支持多厂商多线路轮询AKIKEY做题
// @author       HYL
// @namespace    http://tampermonkey.net/
// @version      0.0.1
// @match        https://*.wjx.top/*
// @match        https://*.wjx.cn/*
// @match        https://*.wjx.com/*
// @connect      *
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    const DEF_THINK_TOK = 0;
    const DEF_OPEN_EXTRA = {};

    const USR_CFG = {
        /*
        可多线路轮询。
        API_FIRM：1=OpenAI 兼容，2=Gemini，3=Anthropic。
        API_KEY：密钥。
        API_URL：API地址，空则用厂商默认值。
        MODEL_NAME：模型名，空则用厂商默认值。
        */
        API_MODELS: [
            {
                routeLbl: "gemini-线路1",
                API_FIRM: 2,
                API_KEY: "你的token1",
                API_URL: "",
                MODEL_NAME: ""
            },
            {
                routeLbl: "gemini-线路2",
                API_FIRM: 2,
                API_KEY: "你的token2",
                API_URL: "",
                MODEL_NAME: ""
            }
        ],
        // 是否自动提交
        AUTO_SEND: false,
        // 全部填完后等几秒再提交；仅 AUTO_SEND 为 true 时有效。
        SEND_DELAY_SEC: 1,
        // 重试次数
        REQ_RETRY: 1,
        // 重试间隔毫秒
        RETRY_GAP_MS: 1000,
        // 答题人信息上下文，可以随便填写
        ROLE_CARD: `
            姓名：张三
            部门: 技术研究部
        `
    };

    function mdlName(route) {
        return route.MODEL_NAME || EP_DEF[route.API_FIRM].model;
    }

    function epUrl(route) {
        const firm = route.API_FIRM;
        if (route.API_URL) {
            let u = route.API_URL.trim();
            if (firm === 1 && !u.includes('/chat/completions')) {
                if (!u.endsWith('/')) u += '/';
                u += 'chat/completions';
                console.log(`CONFIG [${route.routeLbl}] 已按 OpenAI 兼容规范补全接口路径：${u}`);
            }
            return u;
        }
        if (firm === 2) {
            const m = mdlName(route);
            return `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${route.API_KEY}`;
        }
        return EP_DEF[firm].url;
    }

    function reqHdrs(route) {
        const firm = route.API_FIRM;
        const h = { "Content-Type": "application/json" };

        if (firm === 1) {
            h["Authorization"] = `Bearer ${route.API_KEY}`;
        } else if (firm === 3) {
            h["x-api-key"] = route.API_KEY;
            h["anthropic-version"] = "2023-06-01";
        }

        return h;
    }

    function mkReqBody(prompt, route) {
        const firm = route.API_FIRM;
        const m = mdlName(route);
        const thinkTok = route.thinkTok != null ? route.thinkTok : DEF_THINK_TOK;
        const openExtra = route.openExtra != null ? route.openExtra : DEF_OPEN_EXTRA;

        if (firm === 1) {
            return {
                model: m,
                messages: [{ role: "user", content: prompt }],
                ...openExtra
            };
        }

        if (firm === 2) {
            const body = {
                contents: [{ parts: [{ text: prompt }] }]
            };
            if (thinkTok > 0) {
                body.generationConfig = {
                    thinkingConfig: {
                        thinkingBudget: thinkTok
                    }
                };
            }
            return body;
        }

        if (firm === 3) {
            const body = {
                model: m,
                max_tokens: 4096,
                messages: [{ role: "user", content: prompt }]
            };
            if (thinkTok > 0) {
                body.thinking = {
                    type: "enabled",
                    budget_tokens: thinkTok
                };
            }
            return body;
        }

        throw new Error(`不支持的 API 厂商：${firm}`);
    }

    function txtFromRes(resJson, route) {
        const firm = route.API_FIRM;

        if (firm === 1) {
            return resJson.choices[0].message.content;
        }

        if (firm === 2) {
            const parts = resJson.candidates[0].content.parts;
            const textParts = parts.filter(p => !p.thought);
            return textParts.map(p => p.text).join("");
        }

        if (firm === 3) {
            const blocks = resJson.content;
            const textBlocks = blocks.filter(b => b.type === "text");
            return textBlocks.map(b => b.text).join("");
        }

        throw new Error(`不支持的 厂商：${firm}`);
    }

    const DOM_MAP = {
        PC: {
            question: '.div_question',
            title: '.div_title_question_all',
            optionItem: 'li',
            textInput: 'textarea, input[type="text"], input[type="number"], input[type="tel"], .inputtext'
        },
        MOBILE: {
            question: '.field',
            title: '.field-label',
            optionItem: '.ui-radio, .ui-checkbox',
            textInput: 'textarea, input[type="text"], input[type="number"], input[type="tel"], .ui-input-text'
        }
    };

    const EP_DEF = {
        1: { model: "gpt-5.2", url: "https://api.openai.com/v1/chat/completions" },
        2: { model: "gemini-3-flash-preview", url: null },
        3: { model: "claude-opus-4.6", url: "https://api.anthropic.com/v1/messages" }
    };

    function pageKind() {
        if (document.querySelectorAll(DOM_MAP.PC.question).length > 0) return 'PC';
        if (document.querySelectorAll(DOM_MAP.MOBILE.question).length > 0) return 'MOBILE';
        return 'UNKNOWN';
    }

    function typeInto(el, val) {
        if (!el) return;
        el.focus();

        const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setVal.call(el, val);

        const evOpt = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new Event('input', evOpt));
        el.dispatchEvent(new Event('change', evOpt));
        el.dispatchEvent(new Event('blur', evOpt));
    }

    function tickConsent() {
        const box = document.getElementById('checkxiexi');
        if (box && !box.checked) {
            console.log("勾选同意........");
            box.click();
            box.checked = true;
        }
    }

    function scanQs() {
        const kind = pageKind();
        if (kind === 'UNKNOWN') return [];

        const sel = DOM_MAP[kind];
        const out = [];
        const nodes = document.querySelectorAll(sel.question);

        nodes.forEach((div, index) => {
            let qId = div.id.replace("div", "");
            if (!qId) qId = index + 1;

            const lab = div.querySelector(sel.title);
            const tit = lab ? lab.innerText.replace(/\r\n/g, "").trim() : "未取得题目";

            let typ = "complex";
            let opts = [];

            const optsEl = div.querySelectorAll(sel.optionItem);
            if (optsEl.length > 0) {
                optsEl.forEach((item, idx) => {
                    let t = item.innerText.trim();
                    if (kind === 'MOBILE') {
                        const lb = item.querySelector('label');
                        if (lb) t = lb.innerText.trim();
                    }
                    opts.push({ index: idx, text: t });
                });

                if (kind === 'PC') {
                    const inp = div.querySelector("input");
                    if (inp) typ = inp.type === 'radio' ? 'radio' : 'checkbox';
                } else {
                    if (div.querySelector('.ui-radio')) typ = 'radio';
                    else if (div.querySelector('.ui-checkbox')) typ = 'checkbox';
                }
            }
            else if (div.querySelector(sel.textInput)) {
                typ = 'text';
            }

            if (typ !== 'complex') {
                out.push({
                    id: qId,
                    domId: div.id,
                    type: typ,
                    title: tit,
                    options: opts
                });
            }
        });
        return out;
    }

    function xhrPost(url, hdrs, body, route) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: hdrs,
                data: JSON.stringify(body),
                onload: (response) => {
                    try {
                        const st = response.status;
                        if (st < 200 || st >= 300) {
                            reject({
                                type: "network",
                                error: new Error(`HTTP ${st}`),
                                status: st,
                                raw: response.responseText
                            });
                            return;
                        }
                        const resJson = JSON.parse(response.responseText);
                        let text = txtFromRes(resJson, route);
                        text = text.replace(/```json|```/g, "").trim();
                        resolve(JSON.parse(text));
                    } catch (e) {
                        reject({ type: "parse", error: e, raw: response.responseText });
                    }
                },
                onerror: (err) => {
                    reject({ type: "network", error: err });
                }
            });
        });
    }

    async function fetchBatchAns(qSlice, route) {
        if (qSlice.length === 0) return { ok: true, answers: [] };

        const tag = `[${route.routeLbl}]`;

        const slim = qSlice.map(q => ({
            id: q.id, type: q.type, title: q.title, options: q.options
        }));

        const prompt = `
            Role: ${USR_CFG.ROLE_CARD}
            Task: Answer the survey questions.
            Format: Return strictly a valid JSON Array. No Markdown code blocks.

            Requirements:
            - For 'radio': return "selection_index" (int, 0-based).
            - For 'checkbox': return "selection_indices" (array of ints).
            - For 'text': return "content" (string, keep it concise).

            Questions: ${JSON.stringify(slim)}
        `;

        const u = epUrl(route);
        const h = reqHdrs(route);
        const body = mkReqBody(prompt, route);

        const firmLbl = { 1: "OpenAI 兼容", 2: "Gemini", 3: "Anthropic" };
        console.log(`${tag}已发起作答请求，线路为 ${firmLbl[route.API_FIRM]}，当前模型为 ${mdlName(route)}。`);

        const maxTry = 1 + (USR_CFG.REQ_RETRY || 0);
        const gap = USR_CFG.RETRY_GAP_MS || 1000;

        for (let n = 1; n <= maxTry; n++) {
            try {
                const result = await xhrPost(u, h, body, route);
                return { ok: true, answers: result };
            } catch (err) {
                if (err.type === "parse") {
                    console.error(`${tag}第 ${n}/${maxTry} 次返回未能解析，详情：`, err.error);
                    console.error(`${tag}原始返回如下：`, err.raw);
                } else {
                    console.error(`${tag}第 ${n}/${maxTry} 次请求未成功，原因：`, err.error);
                }

                if (n < maxTry) {
                    console.log(`${tag}将于 ${gap} 毫秒后再次尝试本线路。`);
                    await new Promise(r => setTimeout(r, gap));
                } else {
                    console.error(`${tag}已达本轮允许的重试上限（配置为 ${USR_CFG.REQ_RETRY} 次附加尝试），该线路暂时停用。`);
                    return { ok: false, answers: null };
                }
            }
        }
        return { ok: false, answers: null };
    }

    function paintQ(rec, ans) {
        const kind = pageKind();
        const sel = DOM_MAP[kind];
        const div = document.getElementById(rec.domId);
        if (!div) return;

        if (ans.content) {
            const inp = div.querySelector('input[type="tel"]') ||
                div.querySelector('textarea') ||
                div.querySelector('input[type="text"]') ||
                div.querySelector('input[type="number"]');
            if (inp) {
                typeInto(inp, ans.content);
            }
        }
        else if (ans.selection_index !== undefined) {
            const items = div.querySelectorAll(sel.optionItem);
            const hit = items[ans.selection_index];
            if (hit) {
                hit.click();
                const lb = hit.querySelector('label');
                if (lb) lb.click();
            }
        }
        else if (ans.selection_indices) {
            const items = div.querySelectorAll(sel.optionItem);
            ans.selection_indices.forEach(idx => {
                if (items[idx]) {
                    let on = false;
                    if (kind === 'PC') {
                        const inp = items[idx].querySelector("input");
                        if (inp && inp.checked) on = true;
                    } else {
                        if (items[idx].classList.contains('ui-checkbox-on')) on = true;
                    }

                    if (!on) {
                        items[idx].click();
                        const lb = items[idx].querySelector('label');
                        if (lb) lb.click();
                    }
                }
            });
        }
    }

    function qDone(div) {
        const inputs = div.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], textarea');
        for (let inp of inputs) {
            if (inp.value && inp.value.trim() !== "") return true;
        }
        if (div.querySelector('input:checked')) return true;
        if (div.querySelector('.ui-radio-on') || div.querySelector('.ui-checkbox-on')) return true;
        return !div.querySelector('input, textarea, .ui-radio, .ui-checkbox');
    }

    function finishNav() {
        const kind = pageKind();
        const sel = DOM_MAP[kind];
        const blocks = document.querySelectorAll(sel.question);

        let skipTo = null;

        for (let div of blocks) {
            if (div.style.display === 'none') continue;
            if (!qDone(div)) {
                skipTo = div;
                break;
            }
        }

        const submitBtn = document.getElementById("submit_button") || document.querySelector(".submitbutton");

        if (skipTo) {
            console.warn(`尚有未完成项（编号 ${skipTo.id}），正在滚动至该处。`);
            skipTo.scrollIntoView({ behavior: "smooth", block: "center" });
            skipTo.style.border = "3px solid #ff4d4f";
            skipTo.style.borderRadius = "5px";
        } else {
            console.log("题目均已处理完毕，正在前往提交区域。");
            if (submitBtn) {
                submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });

                if (USR_CFG.AUTO_SEND) {
                    const sec = Number(USR_CFG.SEND_DELAY_SEC);
                    const ms = (Number.isFinite(sec) && sec >= 0 ? sec : 1) * 1000;
                    console.log(`将在 ${ms / 1000} 秒后代为点击提交。`);
                    setTimeout(() => {
                        submitBtn.click();
                        setTimeout(() => {
                            const ok = document.querySelector(".layui-layer-btn0");
                            if (ok) ok.click();
                        }, 500);
                    }, ms);
                }
            }
        }
    }

    function chkRoutes() {
        const list = USR_CFG.API_MODELS;
        if (!list || list.length === 0) {
            console.error("API_MODELS 不可为空，请至少保留一条含 routeLbl 与 API_KEY 的线路。");
            return false;
        }
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (!r.routeLbl || String(r.routeLbl).trim() === "") {
                console.error(`API_MODELS[${i}] 缺少 routeLbl（线路显示名）。`);
                return false;
            }
            if (!r.API_KEY) {
                console.error(`线路「${r.routeLbl}」尚未填写 API_KEY。`);
                return false;
            }
            if (![1, 2, 3].includes(r.API_FIRM)) {
                console.error(`线路「${r.routeLbl}」的 API_FIRM 须为 1、2 或 3。`);
                return false;
            }
        }
        return true;
    }

    async function runFlow() {
        if (!chkRoutes()) return;

        const all = scanQs();
        if (all.length === 0) {
            console.error("未发现可识别的题目节点，脚本终止。");
            return;
        }
        console.log(`已开始调用模型作答，共 ${all.length} 题；当前可用线路 ${USR_CFG.API_MODELS.length} 条（失效线路会从本轮队列中移除）。`);

        //const batchSize = 3;
        const batchSize = 15;
        const pool = USR_CFG.API_MODELS.slice();
        let rot = 0;

        for (let i = 0; i < all.length; i += batchSize) {
            const chunk = all.slice(i, i + batchSize);
            const span = `${i + 1} - ${Math.min(i + batchSize, all.length)}`;
            let left = chunk.slice();

            while (left.length > 0 && pool.length > 0) {
                const j = rot % pool.length;
                const route = pool[j];
                const tag = `[${route.routeLbl}]`;

                console.log(`${tag}本题组 ${span}，尚余 ${left.length} 题待返回；当前选用线路「${route.routeLbl}」，队列中尚有 ${pool.length} 条。`);

                const res = await fetchBatchAns(left, route);
                if (!res.ok) {
                    console.warn(`${tag}线路「${route.routeLbl}」已从本轮队列剔除；后续线路将接手尚未完成的 ${left.length} 题。`);
                    pool.splice(j, 1);
                    continue;
                }

                const arr = res.answers || [];
                arr.forEach(one => {
                    const hit = chunk.find(q => q.id == one.id);
                    if (hit) paintQ(hit, one);
                });

                const got = new Set(arr.map(a => String(a.id)));
                const nextLeft = left.filter(q => !got.has(String(q.id)));

                if (nextLeft.length === 0) {
                    rot = (rot + 1) % Math.max(pool.length, 1);
                    left = [];
                    break;
                }

                left = nextLeft;
                console.warn(`${tag}仍有 ${left.length} 题未收到答案，将交由下一条线路继续。`);

                if (pool.length <= 1) {
                    console.error("仅剩一条线路且无法在本线补全余题，本批次补全中止。");
                    break;
                }

                rot = (rot + 1) % pool.length;
            }

            if (left.length > 0) {
                console.error("已无可用线路或无法补全本批余题，后续批次不再执行。");
                break;
            }

            await new Promise(r => setTimeout(r, 200));
        }

        tickConsent();

        setTimeout(finishNav, 500);
    }

    setTimeout(runFlow, 1000);

})();
