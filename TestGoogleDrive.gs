// ═══════════════════════════════════════════════════════════════
//  TEST 3: Google Drive folder access + write test
//  ---------------------------------------------------------------
//  Creates a small test Google Doc and moves it to the output
//  folder, then logs the URL. Cleans up after verification.
//  Before running, set Script Property:  OUTPUT_FOLDER_ID
// ═══════════════════════════════════════════════════════════════

function testGoogleDriveFolder() {
  var folderId = PropertiesService.getScriptProperties().getProperty("OUTPUT_FOLDER_ID");

  if (!folderId) {
    console.log("❌ FAIL — OUTPUT_FOLDER_ID is not set in Script Properties.");
    return;
  }

  try {
    // Verify folder exists and is accessible
    var folder = DriveApp.getFolderById(folderId);
    console.log("✅ Folder found: " + folder.getName());

    // Create a test document
    var doc = DocumentApp.create("_TEST_ Job App Assistant — Delete Me");
    doc.getBody().clear();
    doc.getBody().appendParagraph("This is a test document created at " + new Date().toISOString());
    doc.getBody().appendParagraph("If you see this file in your output folder, the integration works!");
    doc.saveAndClose();

    // Move to target folder
    var file = DriveApp.getFileById(doc.getId());
    file.moveTo(folder);

    console.log("✅ SUCCESS — Test doc created and moved to folder.");
    console.log("   Doc URL: " + doc.getUrl());
    console.log("   Folder: " + folder.getName());
    console.log("");
    console.log("   👉 Check your Drive folder now. You can delete the test doc afterwards.");

  } catch (err) {
    console.log("❌ FAIL — " + err.message);
    console.log("   Make sure the Folder ID is correct and the script has access.");
  }
}
