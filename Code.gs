// ═══════════════════════════════════════════════════════════════════
//  Job Application Assistant — Google Apps Script (JD text input)
//  ---------------------------------------------------------------
//  Script Properties (Project Settings → Script Properties):
//    GEMINI_API_KEY    — Gemini API key
//    CV_DOC_ID         — Google Doc ID of base CV
//    OUTPUT_FOLDER_ID  — Google Drive folder ID for outputs (optional)
// ═══════════════════════════════════════════════════════════════════

function doGet(e) {
  return _jsonResponse({ success: true, message: "Job Application Assistant API is running." });
}

/**
 * POST body should contain JSON string, ideally sent as text/plain from browser:
 * { "jd": "...." }
 */
function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    if (!raw) return _jsonResponse({ success: false, error: "No request body provided." });

    // Accept both:
    // - text/plain containing JSON
    // - application/json containing JSON
    var body = _safeJsonParse(raw);
    if (!body) return _jsonResponse({ success: false, error: "Request body must be valid JSON." });

    var jdText = (body.jd || "").trim();
    if (!jdText || jdText.length < 30) {
      return _jsonResponse({ success: false, error: "No job description text provided (min 30 chars)." });
    }

    // 1) Extract concise signals from JD
    var signals = extractJDSignals(jdText);

    // 2) Read base CV
    var cvText = getBaseCvText();

    // 3) Generate tailored CV + cover letter
    var aiResult = callGeminiWithSignals(signals, cvText);

    // 4) Save to Drive
    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty("OUTPUT_FOLDER_ID") || "";
    var roleName = (signals && signals.t) ? signals.t : "Job Application";

    var cvDocUrl = saveToGoogleDrive("Tailored CV — " + roleName, aiResult.tailoredCv, folderId);
    var clDocUrl = saveToGoogleDrive("Cover Letter — " + roleName, aiResult.coverLetter, folderId);

    return _jsonResponse({
      success: true,
      data: {
        role: roleName,
        cvUrl: cvDocUrl,
        coverLetterUrl: clDocUrl,
        signals: signals // remove in production if you don't want to expose it
      }
    });

  } catch (err) {
    console.error("doPost error:", err);
    return _jsonResponse({ success: false, error: err.message || "An unexpected error occurred." });
  }
}

/* ---------- CV reader ---------- */

function getBaseCvText() {
  var props = PropertiesService.getScriptProperties();
  var docId = props.getProperty("CV_DOC_ID");
  if (!docId) throw new Error("CV_DOC_ID is not set in Script Properties.");

  var doc = DocumentApp.openById(docId);
  var text = doc.getBody().getText();
  if (!text || text.trim().length < 20) throw new Error("The base CV document appears to be empty.");
  return text;
}

/* ---------- Gemini: JD -> concise signals ---------- */

/**
 * Returns minified JSON:
 * {"c":"","t":"","rt":"","p":[],"mh":[],"nh":[],"r":[],"kpi":[],"ats":[]}
 */
function extractJDSignals(jdText) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in Script Properties.");

  var endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    encodeURIComponent(apiKey);

  var systemInstruction = [
    "Extract concise hiring signals for CV tailoring.",
    "Return ONLY valid minified JSON with EXACT keys/structure:",
    '{"c":"","t":"","rt":"","p":[],"mh":[],"nh":[],"r":[],"kpi":[],"ats":[]}',
    "",
    "Rules:",
    "- JSON only. No markdown. No commentary.",
    "- Each list item <= 8 words.",
    "- Deduplicate + normalize terms (EN16931 -> EN 16931).",
    "- Exclude location/hybrid/benefits/contact/marketing.",
    "",
    "Limits:",
    "- p: max 5 ranked.",
    "- mh: max 10; nh: max 7; r: max 7.",
    "- kpi: max 6; if none explicit, infer up to 3.",
    "- ats: max 30; include standards/tools/platforms/protocols/domain terms; avoid generic soft skills."
  ].join("\n");

  var payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ parts: [{ text: "JD:\n" + jdText }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          c: { type: "STRING" },
          t: { type: "STRING" },
          rt: { type: "STRING" },
          p: { type: "ARRAY", items: { type: "STRING" }, maxItems: 5 },
          mh: { type: "ARRAY", items: { type: "STRING" }, maxItems: 10 },
          nh: { type: "ARRAY", items: { type: "STRING" }, maxItems: 7 },
          r: { type: "ARRAY", items: { type: "STRING" }, maxItems: 7 },
          kpi: { type: "ARRAY", items: { type: "STRING" }, maxItems: 6 },
          ats: { type: "ARRAY", items: { type: "STRING" }, maxItems: 30 }
        },
        required: ["c", "t", "rt", "p", "mh", "nh", "r", "kpi", "ats"]
      }
    }
  };

  var resp = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = _safeJsonParse(resp.getContentText());
  if (code !== 200) {
    var msg = (body && body.error && body.error.message) ? body.error.message : ("Gemini API error (HTTP " + code + ")");
    throw new Error(msg);
  }

  var outText = body
    && body.candidates
    && body.candidates[0]
    && body.candidates[0].content
    && body.candidates[0].content.parts
    && body.candidates[0].content.parts[0]
    && body.candidates[0].content.parts[0].text;

  if (!outText) throw new Error("Gemini returned no JD signals output.");

  var signals = _safeJsonParse(outText);
  if (!signals) throw new Error("JD signals output was not valid JSON.");

  // minimal normalization
  signals.c = signals.c || "";
  signals.t = signals.t || "";
  signals.rt = signals.rt || "";
  signals.p = Array.isArray(signals.p) ? signals.p : [];
  signals.mh = Array.isArray(signals.mh) ? signals.mh : [];
  signals.nh = Array.isArray(signals.nh) ? signals.nh : [];
  signals.r = Array.isArray(signals.r) ? signals.r : [];
  signals.kpi = Array.isArray(signals.kpi) ? signals.kpi : [];
  signals.ats = Array.isArray(signals.ats) ? signals.ats : [];

  return signals;
}

/* ---------- Gemini: signals + CV -> tailored docs ---------- */

function callGeminiWithSignals(signals, cvText) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in Script Properties.");

  var endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    encodeURIComponent(apiKey);

  var systemPrompt = [
  "You are an ATS-focused CV strategist.",
  "",
  "Your task is to RESTRUCTURE and OPTIMISE the CV to maximise alignment with the hiring signals.",
  "",
  "STRICT RULES:",
  "- Do NOT invent experience, tools, metrics, certifications, or roles.",
  "- You may reorder sections and rewrite bullet points.",
  "- Remove or de-emphasise content not aligned with the role.",
  "- Every bullet in Experience must clearly support at least one hiring priority (signals.p or signals.mh).",
  "- Use terminology from signals.ats when truthful.",
  "- Optimise for ATS keyword density naturally.",
  "- Prioritise impact and measurable outcomes if present in CV.",
  "",
  "STRUCTURE REQUIREMENTS:",
  "1. Professional Summary (role-specific).",
  "2. Core Skills section (derived only from signals.mh and supported CV content).",
  "3. Experience:",
  "   - 4–6 bullets per role.",
  "   - Strong action verbs.",
  "   - Rewritten to mirror signals.r and signals.p.",
  "4. Education.",
  "",
  "Return ONLY JSON: { tailoredCv, coverLetter }"
].join("\n");

  var userPrompt = [
    "HIRING_SIGNALS_JSON:",
    JSON.stringify(signals),
    "",
    "CANDIDATE_CV:",
    cvText,
    "",
    "Write a tailored CV (plain text with line breaks) and a cover letter (<=350 words) addressed to Hiring Manager.",
    "Return JSON only."
  ].join("\n");

  var payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          tailoredCv: { type: "STRING" },
          coverLetter: { type: "STRING" }
        },
        required: ["tailoredCv", "coverLetter"]
      }
    }
  };

  var resp = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = _safeJsonParse(resp.getContentText());
  if (code !== 200) {
    var msg = (body && body.error && body.error.message) ? body.error.message : ("Gemini API error (HTTP " + code + ")");
    throw new Error(msg);
  }

  var outText = body
    && body.candidates
    && body.candidates[0]
    && body.candidates[0].content
    && body.candidates[0].content.parts
    && body.candidates[0].content.parts[0]
    && body.candidates[0].content.parts[0].text;

  if (!outText) throw new Error("Gemini returned no tailoring output.");

  var result = _safeJsonParse(outText);
  if (!result || !result.tailoredCv || !result.coverLetter) throw new Error("Gemini returned an incomplete response.");

  return result;
}

/* ---------- Google Drive / Docs ---------- */

function saveToGoogleDrive(title, content, folderId) {
  var doc = DocumentApp.create(title);
  var body = doc.getBody();
  body.clear();

  // Global style constants
  var FONT = "Times New Roman";
  var SIZE = 12;

  // Helpers
  function applyBodyStyle(par) {
  var t = par.editAsText();
  t.setFontFamily(FONT);
  t.setFontSize(SIZE);

  // ✅ IMPORTANT: reset inherited styles
  t.setBold(false);
  t.setUnderline(false);

  par.setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY);
  par.setSpacingAfter(1);
  par.setSpacingBefore(0);
  return par;
  }

  function makeHeading(line) {
    var p = body.appendParagraph(line);
    applyBodyStyle(p);
    var t = p.editAsText();
    t.setBold(true);
    t.setUnderline(true);
    p.setSpacingBefore(1);
    p.setSpacingAfter(1);
    return p;
  }

  function makeCenteredHeader(line, isNameLine) {
    var p = body.appendParagraph(line);
    var t = p.editAsText();
    t.setFontFamily(FONT).setFontSize(SIZE);
    t.setBold(!!isNameLine);
    p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    p.setSpacingAfter(isNameLine ? 2 : 8);
    return p;
  }

  function makeBullet(line) {
    var item = body.appendListItem(line);
    item.clear(); // removes inherited styling influence
    item.setGlyphType(DocumentApp.GlyphType.BULLET);
    applyBodyStyle(item);
    item.setIndentStart(18);
    item.setIndentFirstLine(0);
    return item;
  }

  function makeBoldLine(line) {
    var p = body.appendParagraph(line);
    applyBodyStyle(p);
    p.editAsText().setBold(true);
    return p;
  }

  // Parsing
  var lines = (content || "").replace(/\r\n/g, "\n").split("\n");

  // Very simple detection: first non-empty line = name, next 1–2 lines = contact
  // You can tweak this if your CV format differs.
  var i = 0;
  while (i < lines.length && !lines[i].trim()) i++;

  if (i < lines.length) {
    makeCenteredHeader(lines[i].trim(), true); // Name
    i++;
  }

  // Contact lines (up to 2 non-empty lines before first section heading)
  var contactCount = 0;
  while (i < lines.length && contactCount < 2) {
    var s = lines[i].trim();
    if (!s) { i++; continue; }

    // Stop if we hit a section heading early
    if (isSectionHeading(s)) break;

    makeCenteredHeader(s, false);
    contactCount++;
    i++;
  }

  // Add a small spacer after header block
  body.appendParagraph("");

  var inExperience = false;

  for (; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) {
      body.appendParagraph(""); // spacer
      continue;
    }

    // Section headings
    if (isSectionHeading(line)) {
      inExperience = /^experience$/i.test(normalizeHeading(line));
      makeHeading(line);
      continue;
    }

    // Bullets
    if (/^[-•]\s+/.test(line)) {
      var bulletText = line.replace(/^[-•]\s+/, "").trim();
      makeBullet(bulletText);
      continue;
    }

    // Experience: role + dates bold (heuristic)
    // Examples it catches:
    // "Product Owner — NTT DATA (2022–2026)"
    // "Senior Analyst | Company | 2021 - Present"
    if (inExperience && looksLikeRoleDatesLine(line)) {
      makeBoldLine(line);
      continue;
    }

    // Normal paragraph
    var p = body.appendParagraph(line);
    applyBodyStyle(p);
  }

  doc.saveAndClose();

  // Move to target folder
  if (folderId) {
    var file = DriveApp.getFileById(doc.getId());
    var folder = DriveApp.getFolderById(folderId);
    file.moveTo(folder);
  }

  return doc.getUrl();
}

/* -------- helpers for headings / experience line detection -------- */

function isSectionHeading(line) {
  var h = normalizeHeading(line);
  return (
    h === "professional summary" ||
    h === "summary" ||
    h === "core skills" ||
    h === "skills" ||
    h === "experience" ||
    h === "work experience" ||
    h === "education" ||
    h === "technical skills" ||
    h === "projects" ||
    h === "publications"
  );
}

function normalizeHeading(line) {
  return String(line || "")
    .replace(/[:\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function looksLikeRoleDatesLine(line) {
  // Heuristics: line contains a year OR "Present" and is not too long
  // and contains a separator often used for role/company lines.
  var hasYearOrPresent = /(\b19\d{2}\b|\b20\d{2}\b|\bpresent\b)/i.test(line);
  var hasSeparator = /[|–—\-•]/.test(line); // separators
  var notTooLong = line.length <= 110;
  return hasYearOrPresent && hasSeparator && notTooLong;
}
/* ---------- Helpers ---------- */

function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _safeJsonParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}