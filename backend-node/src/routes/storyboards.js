const fs = require('fs');
const path = require('path');
const response = require('../response');
const storyboardService = require('../services/storyboardService');
const episodeStoryboardService = require('../services/episodeStoryboardService');
const framePromptService = require('../services/framePromptService');
const aiClient = require('../services/aiClient');
const promptI18n = require('../services/promptI18n');
const angleService = require('../services/angleService');

/**
 * 分镜主图路径：storyboards.local_path 常与图生记录不同步（图在 image_generations），按存在性解析。
 * @returns {string|null} storage 相对路径
 */
function resolveStoryboardImageLocalPath(db, storageBase, storyboardId, sbRow) {
  const normalizeRel = (rel) => (rel && String(rel).trim() ? String(rel).trim().replace(/^\//, '') : '');
  const tryRel = (rel) => {
    const r = normalizeRel(rel);
    if (!r) return null;
    const abs = path.join(storageBase, r);
    return fs.existsSync(abs) ? r : null;
  };
  const fromSb = tryRel(sbRow?.local_path);
  if (fromSb) return fromSb;
  const ig = db.prepare(
    `SELECT local_path FROM image_generations
     WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
       AND local_path IS NOT NULL AND TRIM(local_path) != ''
     ORDER BY id DESC
     LIMIT 1`
  ).get(storyboardId);
  return tryRel(ig?.local_path);
}

/** 全能片段：@图片N 与中英字、引号之间补半角空格，便于模型与接口解析 */
function normalizeUniversalSegmentAtImageSpacing(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(
    /@图片(\d+)(?=[\u4e00-\u9fffA-Za-z「『【（])/gu,
    '@图片$1 '
  );
}

/** 将「分镜1 N秒:」与请求中的分镜时长对齐 */
function forceUniversalSegmentLine4Duration(text, durationLabel) {
  if (!text || typeof text !== 'string' || !durationLabel) return text;
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => /^\s*分镜1：\s*\d/.test(l));
  if (i < 0) return text;
  lines[i] = lines[i].replace(/^\s*分镜1：\s*\d+(?:\.\d+)?秒:\s*/i, `分镜1： ${durationLabel}秒: `);
  return lines.join('\n');
}

function routes(db, log) {
  return {
    create: (req, res) => {
      try {
        const sb = storyboardService.createStoryboard(db, log, req.body || {});
        response.created(res, sb);
      } catch (err) {
        log.error('storyboards create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    insertBefore: (req, res) => {
      try {
        const sb = storyboardService.insertBeforeStoryboard(db, log, req.params.id);
        if (!sb) return response.notFound(res, '目标分镜不存在');
        response.created(res, sb);
      } catch (err) {
        log.error('storyboards insertBefore', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    getOne: (req, res) => {
      try {
        const sb = storyboardService.getStoryboardById(db, req.params.id);
        if (!sb) return response.notFound(res, '分镜不存在');
        response.success(res, sb);
      } catch (err) {
        log.error('storyboards getOne', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    update: (req, res) => {
      try {
        const sb = storyboardService.updateStoryboard(db, log, req.params.id, req.body || {});
        if (!sb) return response.notFound(res, '分镜不存在');
        response.success(res, sb);
      } catch (err) {
        log.error('storyboards update', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = storyboardService.deleteStoryboard(db, log, req.params.id);
        if (!ok) return response.notFound(res, '分镜不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('storyboards delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    framePrompt: (req, res) => {
      try {
        const body = req.body || {};
        const frameType = body.frame_type || 'first';
        const panelCount = body.panel_count || 3;
        const model = body.model || '';
        const taskId = framePromptService.generateFramePrompt(db, log, req.params.id, frameType, panelCount, model);
        response.success(res, {
          task_id: taskId,
          status: 'pending',
          message: '帧提示词生成任务已创建，正在后台处理...',
        });
      } catch (err) {
        log.error('storyboards frame-prompt', { error: err.message });
        if (err.message && (err.message.includes('分镜不存在') || err.message.includes('不支持的'))) {
          return response.badRequest(res, err.message);
        }
        response.internalError(res, err.message);
      }
    },
    framePromptsGet: (req, res) => {
      try {
        const list = framePromptService.getFramePrompts(db, req.params.id);
        response.success(res, { frame_prompts: list });
      } catch (err) {
        log.error('storyboards frame-prompts', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeStoryboardsGenerate: (req, res) => {
      try {
        const taskId = episodeStoryboardService.generateStoryboard(
          db,
          log,
          req.params.episode_id,
          req.query.model,
          req.query.style
        );
        response.success(res, { task_id: taskId, status: 'pending', message: '分镜头生成任务已创建，正在后台处理...' });
      } catch (err) {
        log.error('episode storyboards generate', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeStoryboardsGet: (req, res) => {
      try {
        const list = episodeStoryboardService.getStoryboardsForEpisode(db, req.params.episode_id);
        response.success(res, { storyboards: list, total: list.length });
      } catch (err) {
        log.error('episode storyboards get', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    // 独立触发单条分镜的 image prompt 优化，结果保存到 storyboards.polished_prompt 并返回
    polishPrompt: async (req, res) => {
      try {
        const sbId = Number(req.params.id);
        const sb = db.prepare(
          'SELECT id, episode_id, storyboard_number, image_prompt, action, dialogue, result, atmosphere, shot_type FROM storyboards WHERE id = ? AND deleted_at IS NULL'
        ).get(sbId);
        if (!sb) return response.notFound(res, '分镜不存在');
        if (!sb.image_prompt && !sb.action && !sb.dialogue) {
          return response.badRequest(res, '该分镜暂无可优化的内容（image_prompt / action / dialogue 均为空）');
        }

        // 通过 episode 查 drama_id
        let dramaId = null;
        try {
          const ep = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(sb.episode_id);
          dramaId = ep?.drama_id ?? null;
        } catch (_) {}

        // 画风：mergeCfgStyleWithDrama 会把 dramas.style 的 value（如 cartoon）展开为完整提示词，与图生一致
        let styleZh = '';
        let styleEn = '';
        try {
          const loadConfig = require('../config').loadConfig;
          const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
          let cfg = loadConfig();
          const dr = dramaId
            ? db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)
            : null;
          cfg = mergeCfgStyleWithDrama(cfg, dr || {});
          styleEn = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
          styleZh = (cfg?.style?.default_style_zh || '').trim();
        } catch (_) {}
        const styleForTokens =
          styleEn ||
          styleZh ||
          'cinematic movie still, anamorphic lens, film grain, dramatic lighting, shallow depth of field, professional cinematography';
        const styleBlockLines = [];
        if (styleZh) styleBlockLines.push(`【画风·最高优先级】${styleZh}`);
        if (styleEn && styleEn !== styleZh) styleBlockLines.push(`MANDATORY ART STYLE: ${styleEn}.`);
        else if (styleEn && !styleZh) styleBlockLines.push(`MANDATORY ART STYLE: ${styleEn}.`);
        else if (!styleZh && !styleEn) styleBlockLines.push(`MANDATORY ART STYLE: ${styleForTokens}.`);

        // 获取前后镜头上下文（含上一镜头连戏状态快照）
        let prevDesc = '(first shot)';
        let nextDesc = '(last shot)';
        let prevContinuityState = null;
        if (sb.episode_id != null && sb.storyboard_number != null) {
          const prevShot = db.prepare(
            'SELECT action, location, time, continuity_snapshot FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1'
          ).get(sb.episode_id, sb.storyboard_number);
          const nextShot = db.prepare(
            'SELECT action, location, time FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL ORDER BY storyboard_number ASC LIMIT 1'
          ).get(sb.episode_id, sb.storyboard_number);
          if (prevShot) {
            prevDesc = (prevShot.action || [prevShot.location, prevShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() || '(first shot)';
            if (prevShot.continuity_snapshot) {
              try { prevContinuityState = JSON.parse(prevShot.continuity_snapshot); } catch (_) {}
            }
          }
          if (nextShot) nextDesc = (nextShot.action || [nextShot.location, nextShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() || '(last shot)';
        }

        // 获取该分镜实际关联的角色名（优先 storyboards.characters JSON，其次 storyboard_characters 表）
        let assetNames = '';
        try {
          const nameSet = new Set();
          // 来源1：storyboards.characters JSON（[{id,name}] 或 [id, ...]）
          const sbFull = db.prepare('SELECT characters FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sbId);
          if (sbFull?.characters) {
            const parsed = JSON.parse(sbFull.characters);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                const cid = typeof item === 'object' && item != null ? item.id : item;
                const c = db.prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(cid));
                if (c?.name) nameSet.add(c.name);
              }
            }
          }
          // 来源2：storyboard_characters 关联表（character_libraries）
          const libLinks = db.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ?').all(sbId);
          for (const link of libLinks) {
            const lib = db.prepare('SELECT name FROM character_libraries WHERE id = ? AND deleted_at IS NULL').get(link.character_id);
            if (lib?.name) nameSet.add(lib.name);
          }
          assetNames = [...nameSet].join(', ');
        } catch (_) {}

        const userPromptLines = [
          ...styleBlockLines,
          sb.image_prompt  ? `PROMPT: ${sb.image_prompt}`    : null,
          sb.action        ? `ACTION: ${sb.action}`          : null,
          sb.dialogue      ? `DIALOGUE: ${sb.dialogue}`      : null,
          sb.result        ? `RESULT: ${sb.result}`          : null,
          sb.atmosphere    ? `ATMOSPHERE: ${sb.atmosphere}`  : null,
          sb.shot_type     ? `SHOT_TYPE: ${sb.shot_type}`    : null,
          `STYLE_TOKENS (repeat in output): ${styleForTokens}`,
          `ASSETS: ${assetNames || 'none'}`,
          prevContinuityState ? `PREV_CONTINUITY_STATE: ${JSON.stringify(prevContinuityState)}` : null,
          `CONTEXT_PREV: ${prevDesc}`,
          `CONTEXT_NEXT: ${nextDesc}`,
          `REMINDER: Output a STATIC SINGLE-FRAME image prompt only. No camera motion, no transitions, no split panels.`,
        ].filter(Boolean);

        const polishedPrompt = await aiClient.generateText(
          db, log, 'text', userPromptLines.join('\n'), promptI18n.getImagePolishPrompt(),
          { scene_key: 'image_polish', max_tokens: 300, temperature: 0.3 }
        );

        if (!polishedPrompt || polishedPrompt.trim().length < 10) {
          return response.badRequest(res, 'AI 返回内容过短，请检查文本模型配置');
        }

        const polished = polishedPrompt.trim();
        const nowIso = new Date().toISOString();
        db.prepare('UPDATE storyboards SET polished_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
          polished, nowIso, sbId
        );
        log.info('[分镜] polishPrompt 完成', { id: sbId, len: polished.length, has_prev_continuity: !!prevContinuityState });

        // 异步提取连戏状态快照并保存（不阻塞响应）
        const snapshotPrompt = promptI18n.getContinuitySnapshotPrompt();
        const snapshotUserPrompt = [`PROMPT: ${polished}`, `ASSETS: ${assetNames || 'none'}`].join('\n');
        aiClient.generateText(db, log, 'text', snapshotUserPrompt, snapshotPrompt, {
          scene_key: 'image_polish', max_tokens: 200, temperature: 0.1,
        }).then((snapshotJson) => {
          if (!snapshotJson?.trim()) return;
          const cleaned = snapshotJson.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
          try {
            JSON.parse(cleaned);
            db.prepare('UPDATE storyboards SET continuity_snapshot = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
              cleaned, new Date().toISOString(), sbId
            );
            log.info('[分镜] polishPrompt 连戏快照已保存', { id: sbId });
          } catch (_) {}
        }).catch(() => {});

        response.success(res, { polished_prompt: polished });
      } catch (err) {
        log.error('storyboards polishPrompt', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /** 全能模式：根据分镜字段 AI 生成 universal_segment_text（含运镜/机位等专业描述） */
    generateUniversalSegmentPrompt: async (req, res) => {
      try {
        const sbId = Number(req.params.id);
        const sb = db.prepare(
          `SELECT id, episode_id, storyboard_number, scene_id, title, description, location, time,
            action, dialogue, narration, result, atmosphere,
            image_prompt, polished_prompt, video_prompt, universal_segment_text,
            shot_type, angle, angle_h, angle_v, angle_s, movement, lighting_style, depth_of_field,
            characters, local_path, duration
           FROM storyboards WHERE id = ? AND deleted_at IS NULL`
        ).get(sbId);
        if (!sb) return response.notFound(res, '分镜不存在');

        let dramaId = null;
        let dramaRow = null;
        try {
          const epRow = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(sb.episode_id);
          dramaId = epRow?.drama_id ?? null;
          if (dramaId) {
            dramaRow = db.prepare(
              'SELECT title, genre, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL'
            ).get(dramaId);
          }
        } catch (_) {}

        let styleZh = '';
        let styleEn = '';
        try {
          const loadConfig = require('../config').loadConfig;
          const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
          let cfg = loadConfig();
          cfg = mergeCfgStyleWithDrama(cfg, dramaRow || {});
          styleEn = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
          styleZh = (cfg?.style?.default_style_zh || '').trim();
        } catch (_) {}

        const chunk = (k, v) => {
          const s = v != null && String(v).trim() ? String(v).trim() : '';
          return s ? `${k}: ${s}` : null;
        };
        const lines = [
          chunk('TITLE', sb.title),
          chunk('DESCRIPTION', sb.description),
          chunk('LOCATION', sb.location),
          chunk('TIME', sb.time),
          chunk('ACTION', sb.action),
          chunk('DIALOGUE', sb.dialogue),
          chunk('NARRATION', sb.narration),
          chunk('RESULT', sb.result),
          chunk('ATMOSPHERE', sb.atmosphere),
          chunk('IMAGE_PROMPT', sb.image_prompt),
          chunk('POLISHED_IMAGE_PROMPT', sb.polished_prompt),
          chunk('VIDEO_PROMPT', sb.video_prompt),
          chunk('SHOT_TYPE', sb.shot_type),
          chunk('ANGLE', sb.angle),
          chunk('ANGLE_H', sb.angle_h),
          chunk('ANGLE_V', sb.angle_v),
          chunk('ANGLE_S', sb.angle_s),
          chunk('MOVEMENT', sb.movement),
          chunk('LIGHTING', sb.lighting_style),
          chunk('DEPTH_OF_FIELD', sb.depth_of_field),
          chunk('CURRENT_UNIVERSAL_SEGMENT', sb.universal_segment_text),
        ].filter(Boolean);

        const hasMediaRef = (row) =>
          row &&
          (String(row.local_path || '').trim() !== '' || String(row.image_url || '').trim() !== '');

        let sceneRow = null;
        let sceneBlock = '';
        if (sb.scene_id) {
          try {
            sceneRow = db.prepare(
              'SELECT location, time, prompt, image_url, local_path FROM scenes WHERE id = ? AND deleted_at IS NULL'
            ).get(sb.scene_id);
            if (sceneRow) {
              const scBits = [
                chunk('SCENE_LOCATION', sceneRow.location),
                chunk('SCENE_TIME', sceneRow.time),
                chunk('SCENE_PROMPT', sceneRow.prompt),
                hasMediaRef(sceneRow) ? 'SCENE_HAS_REFERENCE_IMAGE: yes' : 'SCENE_HAS_REFERENCE_IMAGE: no',
              ].filter(Boolean);
              sceneBlock = scBits.join('\n');
            }
          } catch (_) {}
        }

        /** 与前端全能参考图顺序一致：先 JSON 角色 id，再 storyboard_characters 库角色 */
        const charOrderEntries = [];
        const charKeySeen = new Set();
        const pushCharEntry = (key, nameHint) => {
          if (!key || charKeySeen.has(key)) return;
          charKeySeen.add(key);
          charOrderEntries.push({
            key,
            nameHint: nameHint != null && String(nameHint).trim() ? String(nameHint).trim() : '',
          });
        };
        try {
          if (sb.characters) {
            const parsed = JSON.parse(sb.characters);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                const cid = typeof item === 'object' && item != null ? item.id : item;
                const idNum = Number(cid);
                if (!Number.isFinite(idNum)) continue;
                const nm =
                  typeof item === 'object' && item != null && item.name != null
                    ? String(item.name).trim()
                    : '';
                pushCharEntry(`drama:${idNum}`, nm);
              }
            }
          }
          const libLinks = db.prepare(
            'SELECT character_id FROM storyboard_characters WHERE storyboard_id = ? ORDER BY id ASC'
          ).all(sbId);
          for (const link of libLinks) {
            const lid = Number(link.character_id);
            if (!Number.isFinite(lid)) continue;
            pushCharEntry(`lib:${lid}`, '');
          }
        } catch (_) {}

        const charNamesOrdered = [];
        const nameSeen = new Set();
        for (const ent of charOrderEntries) {
          let row = null;
          if (ent.key.startsWith('drama:')) {
            row = db
              .prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL')
              .get(Number(ent.key.slice(6)));
          } else if (ent.key.startsWith('lib:')) {
            row = db
              .prepare('SELECT name FROM character_libraries WHERE id = ? AND deleted_at IS NULL')
              .get(Number(ent.key.slice(4)));
          }
          const nm = (row?.name || ent.nameHint || '').trim();
          if (nm && !nameSeen.has(nm)) {
            nameSeen.add(nm);
            charNamesOrdered.push(nm);
          }
        }
        const charNames = charNamesOrdered.join(', ');

        let propRows = [];
        try {
          propRows =
            db
              .prepare(
                `SELECT p.id, p.name, p.local_path, p.image_url FROM storyboard_props sp
             JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
             WHERE sp.storyboard_id = ?
             ORDER BY sp.prop_id ASC`
              )
              .all(sbId) || [];
        } catch (_) {
          propRows = [];
        }
        const propNamesOrdered = [];
        const propSeen = new Set();
        for (const r of propRows) {
          const n = r?.name != null && String(r.name).trim() ? String(r.name).trim() : '';
          if (n && !propSeen.has(n)) {
            propSeen.add(n);
            propNamesOrdered.push(n);
          }
        }
        const propNames = propNamesOrdered;

        let prevDesc = '(first shot)';
        let nextDesc = '(last shot)';
        if (sb.episode_id != null && sb.storyboard_number != null) {
          const prevShot = db.prepare(
            'SELECT action, location, time FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1'
          ).get(sb.episode_id, sb.storyboard_number);
          const nextShot = db.prepare(
            'SELECT action, location, time FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL ORDER BY storyboard_number ASC LIMIT 1'
          ).get(sb.episode_id, sb.storyboard_number);
          if (prevShot) {
            prevDesc = (prevShot.action || [prevShot.location, prevShot.time].filter(Boolean).join(' ')).slice(0, 160).trim() || '(first shot)';
          }
          if (nextShot) {
            nextDesc = (nextShot.action || [nextShot.location, nextShot.time].filter(Boolean).join(' ')).slice(0, 160).trim() || '(last shot)';
          }
        }

        const ig = db.prepare(
          `SELECT 1 FROM image_generations
           WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
             AND (local_path IS NOT NULL AND TRIM(local_path) != '' OR image_url IS NOT NULL AND TRIM(image_url) != '')
           LIMIT 1`
        ).get(sbId);
        const sbHasFrame = !!(sb.local_path && String(sb.local_path).trim()) || !!ig;

        /** 与 collectSbOmniReferenceAbsoluteUrls 一致：场景(有图) → 角色(有图,绑定序) → 道具(有图) → 分镜主图 */
        const slots = [];
        const pushSlot = (kind, summary) => {
          const num = slots.length + 1;
          const brief = String(summary || '').trim() || kind;
          slots.push({ num, tag: `@图片${num}`, kind, summary: brief });
        };
        if (sceneRow && hasMediaRef(sceneRow)) {
          pushSlot('场景', String(sceneRow.location || '').trim() || '场景环境');
        }
        for (const ent of charOrderEntries) {
          let row = null;
          if (ent.key.startsWith('drama:')) {
            row = db
              .prepare(
                'SELECT name, local_path, image_url FROM characters WHERE id = ? AND deleted_at IS NULL'
              )
              .get(Number(ent.key.slice(6)));
          } else if (ent.key.startsWith('lib:')) {
            row = db
              .prepare(
                'SELECT name, local_path, image_url FROM character_libraries WHERE id = ? AND deleted_at IS NULL'
              )
              .get(Number(ent.key.slice(4)));
          }
          if (!hasMediaRef(row)) continue;
          const cn = String(row.name || ent.nameHint || '角色').trim();
          pushSlot('角色', cn);
        }
        for (const pr of propRows) {
          if (!hasMediaRef(pr)) continue;
          pushSlot('道具', String(pr.name || '道具').trim());
        }
        if (sbHasFrame) {
          pushSlot('分镜主图', '分镜首帧或主参考图');
        }

        const imageSlotMapBlock = [
          'IMAGE_SLOT_MAP（全能模式提交视频时参考图顺序；正文仅可使用下列占位符，与 API 一致）:',
          ...slots.map((s) => `${s.tag} = ${s.kind}「${s.summary}」`),
        ].join('\n');

        const charSlots = slots.filter((s) => s.kind === '角色');
        const sceneFirst = slots.length > 0 && slots[0].kind === '场景';
        const charBindingBlock =
          charSlots.length > 0
            ? [
                sceneFirst
                  ? 'CHARACTER_IMAGE_BINDING（@图片1 仅为场景/环境；人物从 @图片2 起依次对应下列姓名，勿把人绑在 @图片1）:'
                  : 'CHARACTER_IMAGE_BINDING（首张参考图非场景，以 IMAGE_SLOT_MAP 为准；人物与下列 @图片N 一一对应）:',
                ...charSlots.map((s) =>
                  sceneFirst
                    ? `「${s.summary}」→ ${s.tag}（外貌/动作绑定 ${s.tag} ，示例：${s.tag} 的侧脸；禁止「@图片1 中的${s.summary}」）`
                    : `「${s.summary}」→ ${s.tag}（外貌/动作绑定 ${s.tag} ，示例：${s.tag} 的侧脸）`
                ),
              ].join('\n')
            : [
                'CHARACTER_IMAGE_BINDING: 当前无「角色」参考槽位；若出现人物且 @图片1 为场景，勿将人物外貌写在 @图片1。',
              ].join('\n');

        if (slots.length === 0) {
          return response.badRequest(
            res,
            '请至少为场景、角色或分镜上传一张参考图后再生成，以便对应 @图片1、@图片2 与 API 参考顺序一致'
          );
        }

        const line3Required =
          slots[0].kind === '场景'
            ? '环境、光影与陈设定性参考 @图片1。若 @图片1 为宫格或多画面拼图，禁止成片复刻其分格或并列布局，仅提取统一的室内空间与光线语义；须单镜头完整连续画面。'
            : '本片段以首张参考图 @图片1 作为画面锚点展开。';

        const charCount = charNamesOrdered.length;
        const propCount = propNames.length;

        let projectClipSec = 5;
        if (dramaRow?.metadata) {
          try {
            const m =
              typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
            const v = Number(m?.video_clip_duration);
            if (Number.isFinite(v) && v > 0) projectClipSec = Math.min(120, Math.max(1, v));
          } catch (_) {}
        }
        const bodyDurRaw =
          req.body && req.body.duration != null && req.body.duration !== ''
            ? Number(req.body.duration)
            : NaN;
        const sbDurRaw = sb.duration != null ? Number(sb.duration) : NaN;
        const durationSec = Number.isFinite(bodyDurRaw) && bodyDurRaw > 0
          ? Math.min(120, Math.max(1, bodyDurRaw))
          : Number.isFinite(sbDurRaw) && sbDurRaw > 0
            ? Math.min(120, Math.max(1, sbDurRaw))
            : projectClipSec;
        const durationLabel = Number.isInteger(durationSec)
          ? String(durationSec)
          : String(Math.round(durationSec * 10) / 10);

        const genreHint = (dramaRow?.genre && String(dramaRow.genre).trim()) || '';
        const dramaTitle = (dramaRow?.title && String(dramaRow.title).trim()) || '';
        const styleHintBlock = [
          `STYLE_HINT:`,
          chunk('DRAMA_TITLE', dramaTitle),
          chunk('DRAMA_GENRE', genreHint),
          chunk('STYLE_ZH', styleZh),
          chunk('STYLE_EN', styleEn),
        ]
          .filter(Boolean)
          .join('\n');

        const refContract = [
          'REFERENCE_RULE:',
          '- 绑定到某张参考图时，只能写 IMAGE_SLOT_MAP 里列出的 @图片N（阿拉伯数字，如 @图片1、@图片2）。',
          '- 禁止用 @场景、@姓名、@林薇、@道具名 等形式指代参考图；需要指图时一律 @图片N。',
          '- 若 @图片1 为「场景」：只写环境/光影/陈设；人物外貌与动作按 CHARACTER_IMAGE_BINDING 从 @图片2 起。若首张参考图即角色，则以 MAP 为准。',
          '- 场景参考若为四宫格/九宫格等拼图：见 SCENE_REFERENCE_LAYOUT；成片须单镜头连续画面，禁止模仿拼图布局。',
          '- 每个 @图片N 与后随的中/英文字之间保留一个半角空格（后处理也会修正，但模型应直接写对）。',
          '- ORDERED_CHARACTER_NAMES 仅供理解剧情，不得当作图占位符。',
          `有图参考槽位数: ${slots.length}；绑定角色数(含无图): ${charCount}；绑定道具数(含无图): ${propCount}`,
        ].join('\n');

        const assetLine = `ORDERED_CHARACTER_NAMES（仅剧情理解）: ${charNames || 'none'}\nORDERED_PROP_NAMES: ${propNames.join(', ') || 'none'}`;

        if (lines.length === 0 && !sceneBlock && !charNames && !propNames.length) {
          return response.badRequest(res, '分镜中暂无可用信息，请先填写动作、对白、视频提示词或绑定场景/角色等');
        }

        const hasSceneSlot = slots.some((s) => s.kind === '场景');
        const sceneLayoutBlock = hasSceneSlot
          ? [
              'SCENE_REFERENCE_LAYOUT（场景参考图可能是多宫格/多视角拼图，仅作内容与空间参考，成片禁止模仿拼图）:',
              '- 场景槽位（通常为 @图片1）常见为四宫格、九宫格或带分割线的多视角场景图：只提取家具、装修、色调、空间关系与光影，不要在提示中引导模型生成「分屏、宫格、多画面并列、复刻参考图网格」。',
              '- 第4行正文必须包含明确约束：单镜头、完整画幅、连续电影画面；无分屏、无宫格、无多画面拼接、不出现参考图式的白线/黑线分割布局。',
            ].join('\n')
          : '';

        const userPrompt = [
          `STRICT_DURATION: 第4行必须以「分镜1： ${durationLabel}秒:」开头（数字与 ${durationLabel} 完全一致，不得擅自改为 5 秒或其他值）。`,
          `DURATION_SECONDS: ${durationLabel}`,
          'LINE3_REQUIRED（第3行必须与下面整句完全一致，含标点）:',
          line3Required,
          `OUTPUT_CONTRACT: 恰好 4 行：第1行「画面风格和类型:」；第2行「生成一个由以下1个分镜组成的视频。」；第3行=LINE3_REQUIRED；第4行「分镜1： ${durationLabel}秒:」+正文。`,
          imageSlotMapBlock,
          sceneLayoutBlock || null,
          charBindingBlock,
          styleHintBlock,
          refContract,
          assetLine,
          sceneBlock || null,
          `CONTEXT_PREV: ${prevDesc}`,
          `CONTEXT_NEXT: ${nextDesc}`,
          '--- STORYBOARD FIELDS ---',
          ...lines,
        ].filter(Boolean).join('\n');

        const out = await aiClient.generateText(
          db,
          log,
          'text',
          userPrompt,
          promptI18n.getUniversalOmniSegmentPrompt(),
          { scene_key: 'image_polish', max_tokens: 1100, temperature: 0.28 }
        );

        if (!out || String(out).trim().length < 20) {
          return response.badRequest(res, 'AI 返回内容过短，请检查文本模型配置');
        }
        let text = String(out).trim();
        text = forceUniversalSegmentLine4Duration(text, durationLabel);
        text = normalizeUniversalSegmentAtImageSpacing(text);
        const nowIso = new Date().toISOString();
        db.prepare('UPDATE storyboards SET universal_segment_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
          text,
          nowIso,
          sbId
        );
        log.info('[分镜] generateUniversalSegmentPrompt 完成', { id: sbId, len: text.length, duration_sec: durationSec });
        response.success(res, { universal_segment_text: text });
      } catch (err) {
        log.error('storyboards generateUniversalSegmentPrompt', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    upscale: async (req, res) => {
      const id = Number(req.params.id);
      const row = db.prepare(
        'SELECT id, local_path, image_url FROM storyboards WHERE id = ? AND deleted_at IS NULL'
      ).get(id);
      if (!row) return response.notFound(res, '分镜不存在');
      try {
        const loadConfig = require('../config').loadConfig;
        const cfg = loadConfig();
        const storageBase = path.isAbsolute(cfg.storage?.local_path)
          ? cfg.storage.local_path
          : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
        const localPath = resolveStoryboardImageLocalPath(db, storageBase, id, row);
        if (!localPath) return response.badRequest(res, '分镜没有本地图片，无法超分');
        const srcFile = path.join(storageBase, localPath);
        let sharp; try { sharp = require('sharp'); } catch (_) { sharp = null; }
        if (!sharp) return response.badRequest(res, 'sharp 模块不可用，无法超分');
        const info = await sharp(srcFile).metadata();
        const scale = 2;
        const newW = (info.width || 512) * scale;
        const newH = (info.height || 512) * scale;
        const ext = path.extname(localPath) || '.jpg';
        const baseName = path.basename(localPath, ext);
        const dirName = path.dirname(localPath);
        const newRelPath = path.join(dirName, baseName + '_2x' + ext).replace(/\\/g, '/');
        const newFile = path.join(storageBase, newRelPath);
        await sharp(srcFile).resize(newW, newH, { kernel: 'lanczos3' }).toFile(newFile);
        const now = new Date().toISOString();
        db.prepare('UPDATE storyboards SET local_path = ?, updated_at = ? WHERE id = ?').run(newRelPath, now, id);
        log.info('storyboard upscale done', { id, newRelPath, newW, newH });
        response.success(res, { local_path: newRelPath, width: newW, height: newH });
      } catch (err) {
        log.error('storyboards upscale', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    // 批量推断摄影参数（movement/lighting_style/depth_of_field）
    // 对 episode 下所有缺少这些字段的分镜进行快速文本推断，不调用 AI，毫秒级完成
    batchInferParams: (req, res) => {
      try {
        const episodeId = Number(req.body?.episode_id);
        const overwrite = !!req.body?.overwrite; // 是否覆盖已有值
        if (!episodeId) return response.badRequest(res, 'episode_id 必填');

        const rows = db.prepare(
          'SELECT id, angle_s, shot_type, atmosphere, time, description, action, movement, lighting_style, depth_of_field FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC'
        ).all(episodeId);

        let updated = 0;
        const now = new Date().toISOString();
        const stmt = db.prepare(
          'UPDATE storyboards SET movement = COALESCE(?, movement), lighting_style = COALESCE(?, lighting_style), depth_of_field = COALESCE(?, depth_of_field), updated_at = ? WHERE id = ?'
        );
        const stmtOverwrite = db.prepare(
          'UPDATE storyboards SET movement = ?, lighting_style = ?, depth_of_field = ?, updated_at = ? WHERE id = ?'
        );

        for (const row of rows) {
          const inferred = angleService.inferPhotographyParams(row);
          // 只更新缺少的字段（除非 overwrite=true）
          const newMovement   = overwrite ? inferred.movement   : (row.movement      ? null : inferred.movement);
          const newLighting   = overwrite ? inferred.lighting_style : (row.lighting_style ? null : inferred.lighting_style);
          const newDof        = overwrite ? inferred.depth_of_field : (row.depth_of_field  ? null : inferred.depth_of_field);

          if (overwrite) {
            if (inferred.movement || inferred.lighting_style || inferred.depth_of_field) {
              stmtOverwrite.run(inferred.movement, inferred.lighting_style, inferred.depth_of_field, now, row.id);
              updated++;
            }
          } else {
            if (newMovement || newLighting || newDof) {
              stmt.run(newMovement, newLighting, newDof, now, row.id);
              updated++;
            }
          }
        }

        log.info('[分镜] batchInferParams 完成', { episode_id: episodeId, total: rows.length, updated, overwrite });
        response.success(res, { total: rows.length, updated });
      } catch (err) {
        log.error('storyboards batchInferParams', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
