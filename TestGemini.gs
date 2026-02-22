// ═══════════════════════════════════════════════════════════════
//  TEST 1: Gemini API connectivity
//  ---------------------------------------------------------------
//  Sends a simple prompt to Gemini 2.5 Flash and logs the reply.
//  Before running, set Script Property:  GEMINI_API_KEY
// ═══════════════════════════════════════════════════════════════

function testGeminiAPI() {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");

  if (!apiKey) {
    console.log("❌ FAIL — GEMINI_API_KEY is not set in Script Properties.");
    return;
  }

  var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;

  var payload = {
    contents: [{
      parts: [{ text: "Reply with exactly: Hello from Gemini! Then tell me today's day of the week." }]
    }]
  };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(endpoint, options);
  var code = response.getResponseCode();
  var body = JSON.parse(response.getContentText());

  if (code === 200) {
    var reply = body.candidates[0].content.parts[0].text;
    console.log("✅ SUCCESS — Gemini responded:");
    console.log(reply);
  } else {
    var errMsg = (body.error && body.error.message) || "Unknown error";
    console.log("❌ FAIL — HTTP " + code + ": " + errMsg);
  }
}
