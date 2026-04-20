// Job Application Assistant - Google Apps Script
//
// Script Properties:
//   GEMINI_API_KEY       Gemini API key
//   OUTPUT_FOLDER_ID     Google Drive folder ID for outputs (optional)
//   CV_TEMPLATE_FILE_ID  Optional Google Drive HTML file to use as CV template

var SOURCE_CONTENT = {
  summary:
    "Senior Business Analyst with 10+ years of experience driving data-driven transformation, automation, and AI-enabled decision-making across IT, media, and supply chain domains. Proven track record of replacing manual processes with scalable solutions using Python, Power platform, and cloud technologies, delivering ~$460K savings and operational efficiency gains. Skilled in leading stakeholders, defining product requirements, and leveraging AI to streamline workflows and enhance business outcomes.",
  skillLines: {
    skillLine1: "Business Analysis: Requirements Gathering, BRD, Stakeholder Management, UAT, Agile/Scrum",
    skillLine2: "Data & Analytics: Power BI (DAX, Power Query), SQL, Advanced Excel, Tableau, Looker",
    skillLine3: "Automation & Tools: Python, Power Apps, Power Automate, Azure Functions, Jira, Confluence",
    skillLine4: "AI & Cloud: RAG, Prompt Engineering, Azure AI, Azure, Google Cloud",
    skillLine5: "ERP & Systems: SAP, Microsoft Dynamics 365 Business Central"
  },
  businessAnalystBullets: [
    "Led digital transformation across 6 business units, partnering with 20+ stakeholders to replace 15+ Excel-based processes with Python solutions, delivering ~$460K in cost savings.",
    "Gathered and translated 30+ business requirements into functional solutions, working with engineering teams in Agile delivery.",
    "Developed 8 Power BI dashboards used by 40+ stakeholders, eliminating manual reporting and saving 40+ hours per week.",
    "Automated 10+ business processes using Power Platform and Azure Functions, saving 120+ hours per month.",
    "Facilitated UAT and stakeholder workshops to ensure alignment between business and technical team.",
    "Delivered sustainability analytics for leadership decision-making, contributing to a 15% reduction in annual carbon footprint."
  ],
  fixedFacts: [
    "Keep the content as short as possible.",
    "Use the same numbers already present as metrics and do not invent new numbers."
  ]
};

function doGet() {
  return _jsonResponse({ success: true, message: "Job Application Assistant API is running." });
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    if (!raw) return _jsonResponse({ success: false, error: "No request body provided." });

    var body = _safeJsonParse(raw);
    if (!body) return _jsonResponse({ success: false, error: "Request body must be valid JSON." });

    var jdText = String(body.jd || "").trim();
    if (jdText.length < 30) {
      return _jsonResponse({ success: false, error: "No job description text provided (min 30 chars)." });
    }

    var signals = extractJDSignals(jdText);
    var tailored = callGeminiForTemplateSections(signals, SOURCE_CONTENT);

    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty("OUTPUT_FOLDER_ID") || "";
    var roleName = (signals && signals.t) ? signals.t : "Job Application";
    var fileToken = buildOutputFileToken(signals);

    var renderedCvHtml = renderCvTemplate(tailored, signals);
    var cvUrl = savePdfToGoogleDrive("Govinda (CV) " + fileToken, renderedCvHtml, folderId);
    var coverLetterUrl = savePlainTextDocToGoogleDrive("Govinda (CL) " + fileToken, tailored.coverLetter, folderId);

    return _jsonResponse({
      success: true,
      data: {
        role: roleName,
        cvUrl: cvUrl,
        coverLetterUrl: coverLetterUrl
      }
    });
  } catch (err) {
    console.error("doPost error:", err);
    return _jsonResponse({ success: false, error: err.message || "An unexpected error occurred." });
  }
}

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
    "Rules:",
    "- JSON only. No markdown. No commentary.",
    "- Each list item <= 8 words.",
    "- Deduplicate and normalize terms.",
    "- Exclude location, hybrid policy, benefits, contact names, and marketing copy.",
    "Limits:",
    "- p max 5 ranked.",
    "- mh max 10; nh max 7; r max 7.",
    "- kpi max 6; infer up to 3 if not explicit.",
    "- ats max 30; include tools, standards, platforms, protocols, and domain terms."
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

  var outText = body &&
    body.candidates &&
    body.candidates[0] &&
    body.candidates[0].content &&
    body.candidates[0].content.parts &&
    body.candidates[0].content.parts[0] &&
    body.candidates[0].content.parts[0].text;

  if (!outText) throw new Error("Gemini returned no JD signals output.");

  var signals = _safeJsonParse(outText);
  if (!signals) throw new Error("JD signals output was not valid JSON.");

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

function callGeminiForTemplateSections(signals, sourceContent) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in Script Properties.");

  var endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    encodeURIComponent(apiKey);

  var systemPrompt = [
    "You are tailoring a fixed CV template.",
    "You must update only these sections:",
    "- professional summary",
    "- 5 fixed skills lines",
    "- bullet points under the existing Business Analyst entry",
    "- cover letter",
    "",
    "STRICT RULES:",
    "- Do not invent experience, employers, dates, degrees, tools, certifications, or metrics.",
    "- Keep role titles, company names, dates, education, and certifications untouched in the final template.",
    "- Do not generate or modify any job titles, company names, dates, education, certifications, or any non-target experience sections.",
    "- Rewrite only the content requested below using facts already supported by the provided source sections.",
    "- Prefer ATS-aligned wording from the hiring signals when truthful.",
    "- Keep bullets concise and impact-oriented.",
    "- Keep the content as short as possible.",
    "- Reuse the same numbers already present in the source content when mentioning metrics.",
    "- Do not invent new numbers or quantitative claims.",
    "- Preserve the core truth of the fixed facts list.",
    "",
    "SKILL LINE KEYS:",
    "- skillLine1 corresponds to Business Analysis",
    "- skillLine2 corresponds to Data & Analytics",
    "- skillLine3 corresponds to Automation & Tools",
    "- skillLine4 corresponds to AI & Cloud",
    "- skillLine5 corresponds to ERP & Systems",
    "",
    "Return JSON only."
  ].join("\n");

  var userPrompt = [
    "HIRING_SIGNALS_JSON:",
    JSON.stringify(signals),
    "",
    "SOURCE_CONTENT_JSON:",
    JSON.stringify(sourceContent),
    "",
    "Return JSON with this exact structure:",
    JSON.stringify({
      summary: ["2-3 short lines"],
      skillLines: {
        skillLine1: "Business Analysis: ...",
        skillLine2: "Data & Analytics: ...",
        skillLine3: "Automation & Tools: ...",
        skillLine4: "AI & Cloud: ...",
        skillLine5: "ERP & Systems: ..."
      },
      businessAnalystBullets: ["bullet"],
      coverLetter: "plain text"
    }),
    "",
    "Requirements:",
    "- summary: 2 or 3 lines.",
    "- skill lines: exactly 5 lines, keep the category labels shown above.",
    "- each skill line should stay concise and ATS-relevant.",
    "- businessAnalystBullets: 5 or 6 bullets.",
    "- coverLetter: <= 350 words, plain text, professional."
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
          summary: { type: "ARRAY", items: { type: "STRING" }, minItems: 2, maxItems: 3 },
          skillLines: {
            type: "OBJECT",
            properties: {
              skillLine1: { type: "STRING" },
              skillLine2: { type: "STRING" },
              skillLine3: { type: "STRING" },
              skillLine4: { type: "STRING" },
              skillLine5: { type: "STRING" }
            },
            required: ["skillLine1", "skillLine2", "skillLine3", "skillLine4", "skillLine5"]
          },
          businessAnalystBullets: { type: "ARRAY", items: { type: "STRING" }, minItems: 5, maxItems: 6 },
          coverLetter: { type: "STRING" }
        },
        required: ["summary", "skillLines", "businessAnalystBullets", "coverLetter"]
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

  var outText = body &&
    body.candidates &&
    body.candidates[0] &&
    body.candidates[0].content &&
    body.candidates[0].content.parts &&
    body.candidates[0].content.parts[0] &&
    body.candidates[0].content.parts[0].text;

  if (!outText) throw new Error("Gemini returned no template section output.");

  var result = _safeJsonParse(outText);
  if (!result) throw new Error("Gemini template response was not valid JSON.");

  result.summary = Array.isArray(result.summary) ? result.summary : [];
  result.skillLines = result.skillLines || {};
  result.skillLines.skillLine1 = String(result.skillLines.skillLine1 || "").trim();
  result.skillLines.skillLine2 = String(result.skillLines.skillLine2 || "").trim();
  result.skillLines.skillLine3 = String(result.skillLines.skillLine3 || "").trim();
  result.skillLines.skillLine4 = String(result.skillLines.skillLine4 || "").trim();
  result.skillLines.skillLine5 = String(result.skillLines.skillLine5 || "").trim();
  result.businessAnalystBullets = Array.isArray(result.businessAnalystBullets) ? result.businessAnalystBullets : [];
  result.coverLetter = String(result.coverLetter || "").trim();

  if (
    !result.summary.length ||
    !result.skillLines.skillLine1 ||
    !result.skillLines.skillLine2 ||
    !result.skillLines.skillLine3 ||
    !result.skillLines.skillLine4 ||
    !result.skillLines.skillLine5 ||
    !result.businessAnalystBullets.length ||
    !result.coverLetter
  ) {
    throw new Error("Gemini returned an incomplete template response.");
  }

  return result;
}

function renderCvTemplate(tailored, signals) {
  var templateHtml = getCvTemplateHtml();
  var summaryHtml = renderParagraphs(tailored.summary);
  var summaryText = tailored.summary.join(" ");

  var replacements = {
    ROLE_TARGET: _escapeHtml(signals.t || ""),
    SUMMARY_HTML: summaryHtml,
    SUMMARY_TEXT: _escapeHtml(summaryText),
    SKILL_LINE_1: _escapeHtml(tailored.skillLines.skillLine1),
    SKILL_LINE_2: _escapeHtml(tailored.skillLines.skillLine2),
    SKILL_LINE_3: _escapeHtml(tailored.skillLines.skillLine3),
    SKILL_LINE_4: _escapeHtml(tailored.skillLines.skillLine4),
    SKILL_LINE_5: _escapeHtml(tailored.skillLines.skillLine5),
    BUSINESS_ANALYST_BULLETS_HTML: renderWordBulletParagraphs(tailored.businessAnalystBullets)
  };

  return templateHtml.replace(/\{\{([A-Z0-9_]+)\}\}/g, function(match, key) {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match;
  });
}

function getCvTemplateHtml() {
  var props = PropertiesService.getScriptProperties();
  var templateFileId = props.getProperty("CV_TEMPLATE_FILE_ID");

  if (templateFileId) {
    return DriveApp.getFileById(templateFileId.trim()).getBlob().getDataAsString();
  }

  return HtmlService.createHtmlOutputFromFile("CvTemplate").getContent();
}

function renderParagraphs(lines) {
  return (lines || [])
    .filter(function(line) { return String(line || "").trim(); })
    .map(function(line) {
      return '<p class="summary-line">' + _escapeHtml(line) + '</p>';
    })
    .join("\n");
}

function renderBulletList(items) {
  var safeItems = (items || []).filter(function(item) { return String(item || "").trim(); });
  return safeItems
    .map(function(item) {
      return '<li>' + _escapeHtml(item) + '</li>';
    })
    .join("\n");
}

function renderWordBulletParagraphs(items) {
  var safeItems = (items || []).filter(function(item) { return String(item || "").trim(); });
  return safeItems
    .map(function(item) {
      return [
        "<p style='margin-top:0cm;margin-right:0cm;margin-bottom:0cm;margin-left:7.1pt;",
        "text-align:justify;text-justify:inter-ideograph;text-indent:-7.1pt;mso-list:",
        "l21 level1 lfo12'><![if !supportLists]><span lang=EN-IN style='font-size:7.5pt;",
        "font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol;",
        "color:black'><span style='mso-list:Ignore'> <span style='font:7.0pt \"Times New Roman\"'>&nbsp;",
        "</span></span></span><![endif]><span dir=LTR></span><span lang=EN-IN",
        "style='font-size:10.0pt;font-family:\"Aptos Light\",sans-serif;color:black;",
        "mso-themecolor:text1'>" + _escapeHtml(item) + "<o:p></o:p></span></p>"
      ].join("\n");
    })
    .join("\n\n");
}

function buildOutputFileToken(signals) {
  var companyToken = abbreviateCompanyName((signals && signals.c) ? signals.c : "");
  var dateToken = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "ddMM");
  return companyToken + " " + dateToken;
}

function abbreviateCompanyName(companyName) {
  var cleaned = String(companyName || "")
    .replace(/&/g, " ")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "BA";

  var words = cleaned.split(" ").filter(function(word) {
    return word && !isCompanyStopWord(word);
  });

  if (!words.length) words = cleaned.split(" ");

  var token = words.map(function(word) {
    return word.charAt(0).toUpperCase();
  }).join("");

  if (token.length > 4) token = token.substring(0, 4);
  if (!token) token = cleaned.replace(/\s+/g, "").substring(0, 3).toUpperCase();
  if (!token) token = "BA";

  return token;
}

function isCompanyStopWord(word) {
  var stopWords = {
    "and": true,
    "the": true,
    "of": true,
    "for": true,
    "group": true,
    "company": true,
    "co": true,
    "corp": true,
    "corporation": true,
    "inc": true,
    "incorporated": true,
    "limited": true,
    "ltd": true,
    "llc": true,
    "plc": true,
    "ag": true,
    "gmbh": true,
    "sa": true,
    "sas": true,
    "as": true,
    "aps": true
  };

  return !!stopWords[String(word || "").toLowerCase()];
}

function savePdfToGoogleDrive(title, htmlContent, folderId) {
  var htmlFile = DriveApp.createFile(title + ".html", htmlContent, MimeType.HTML);
  var pdfBlob = htmlFile.getBlob().getAs(MimeType.PDF).setName(title + ".pdf");
  var pdfFile = DriveApp.createFile(pdfBlob);

  if (folderId) {
    var folder = DriveApp.getFolderById(folderId.trim());
    pdfFile.moveTo(folder);
  }

  htmlFile.setTrashed(true);

  return pdfFile.getUrl();
}

function savePlainTextDocToGoogleDrive(title, content, folderId) {
  var doc = DocumentApp.create(title);
  var body = doc.getBody();
  body.clear();

  String(content || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .forEach(function(paragraph) {
      var text = paragraph.trim();
      if (text) body.appendParagraph(text);
    });

  doc.saveAndClose();

  if (folderId) {
    var file = DriveApp.getFileById(doc.getId());
    var folder = DriveApp.getFolderById(folderId.trim());
    file.moveTo(folder);
  }

  return doc.getUrl();
}

function _escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}
