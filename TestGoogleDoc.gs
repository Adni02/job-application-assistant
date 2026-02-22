// ═══════════════════════════════════════════════════════════════
//  TEST 2: Google Doc read access (your base CV)
//  ---------------------------------------------------------------
//  Opens the CV Google Doc and logs the first 500 characters.
//  Before running, set Script Property:  CV_DOC_ID
// ═══════════════════════════════════════════════════════════════

function testGoogleDoc() {
  var docId = PropertiesService.getScriptProperties().getProperty("CV_DOC_ID");

  if (!docId) {
    console.log("❌ FAIL — CV_DOC_ID is not set in Script Properties.");
    return;
  }

  // Strip any accidental whitespace
  docId = docId.trim();

  console.log("── Diagnostic info ──────────────────────────────");
  console.log("   Script running as: " + Session.getActiveUser().getEmail());
  console.log("   Doc ID being used: " + docId);
  console.log("   Doc ID length: " + docId.length + " chars (typical is 44)");
  console.log("─────────────────────────────────────────────────");

  // Check 1: Try accessing via DriveApp first (gives a clearer error)
  try {
    var driveFile = DriveApp.getFileById(docId);
    console.log("✅ DriveApp can see the file: " + driveFile.getName());
    console.log("   Owner: " + driveFile.getOwner().getEmail());
    console.log("   MIME type: " + driveFile.getMimeType());
  } catch (driveErr) {
    console.log("❌ DriveApp cannot access this file: " + driveErr.message);
    console.log("");
    console.log("   Likely causes:");
    console.log("   1. The Doc is in a DIFFERENT Google account than the one running this script.");
    console.log("      → The script runs as: " + Session.getActiveUser().getEmail());
    console.log("      → Make sure the CV Doc is owned by or shared with that account.");
    console.log("   2. The Doc ID was copied incorrectly from the URL.");
    console.log("      → From the Doc URL: docs.google.com/document/d/[COPY THIS PART]/edit");
    console.log("      → It should be ~44 characters, letters, numbers, hyphens and underscores only.");
    console.log("");
    console.log("   FIX: Share the CV Google Doc with " + Session.getActiveUser().getEmail() + " (at least Viewer access).");
    return;
  }

  // Check 2: Now try opening as a Document
  try {
    var doc = DocumentApp.openById(docId);
    var text = doc.getBody().getText();
    var title = doc.getName();

    console.log("✅ SUCCESS — DocumentApp opened the doc:");
    console.log("   Title: " + title);
    console.log("   Total characters: " + text.length);
    console.log("   First 500 chars:");
    console.log("   ---");
    console.log(text.substring(0, 500));
    console.log("   ---");
  } catch (docErr) {
    console.log("❌ DriveApp found the file but DocumentApp cannot open it: " + docErr.message);
    console.log("   Make sure the file is actually a Google Doc (not a PDF or Word file).");
  }
}
