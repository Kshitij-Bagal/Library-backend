import express from "express";
import cors from "cors";
import multer from "multer";
import { google } from "googleapis";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Google Drive API Setup
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({ version: "v3", auth });

// Multer Storage (Temporary)
const upload = multer({ dest: "uploads/" });

// Google Drive Folder ID (Set in .env)
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// Local metadata file
const METADATA_FILE = "metadata.json";

// Ensure metadata.json exists
if (!fs.existsSync(METADATA_FILE)) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify([], null, 2));
}

// Function to upload a file to Google Drive
async function uploadToDrive(filePath, fileName, mimeType) {
  const fileMetadata = { name: fileName, parents: [FOLDER_ID] };
  const media = { mimeType, body: fs.createReadStream(filePath) };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: "id, webViewLink, webContentLink",
  });

  return response.data;
}

// 📌 Upload Route (PDF + Image + Metadata)
app.post("/upload", upload.fields([{ name: "pdf" }, { name: "image" }]), async (req, res) => {
  try {
    const { title, author, description } = req.body;
    const pdf = req.files["pdf"][0];
    const image = req.files["image"][0];

    // Rename files using book title
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, "_");
    const pdfFileName = `${sanitizedTitle}.pdf`;
    const imageFileName = `${sanitizedTitle}.jpg`;

    // Move files to rename them
    const pdfPath = `uploads/${pdfFileName}`;
    const imagePath = `uploads/${imageFileName}`;
    fs.renameSync(pdf.path, pdfPath);
    fs.renameSync(image.path, imagePath);

    // Upload PDF and Image to Drive
    const pdfResponse = await uploadToDrive(pdfPath, pdfFileName, "application/pdf");
    const imageResponse = await uploadToDrive(imagePath, imageFileName, "image/jpeg");

    // Load existing metadata
    const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));

    // Add new book entry
    const newBook = {
      title,
      author,
      description,
      pdfUrl: pdfResponse.webContentLink,
      imageUrl: imageResponse.webContentLink,
      uploadDate: new Date().toISOString(),
    };

    metadata.push(newBook);

    // Save updated metadata.json locally
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));

    // Upload metadata.json to Google Drive
    const metadataResponse = await uploadToDrive(METADATA_FILE, "metadata.json", "application/json");

    res.json({ message: "Upload successful!", metadataUrl: metadataResponse.webContentLink });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📌 Route to Get All Books from metadata.json
app.get("/books", (req, res) => {
  try {
    const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));
    res.json(metadata);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📌 Route to Serve metadata.js Dynamically
app.get("/metadata.js", (req, res) => {
  try {
    const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));

    // Convert metadata to a JavaScript module format
    const metadataJS = `export const data = ${JSON.stringify(metadata, null, 2)};`;

    // Set response headers
    res.setHeader("Content-Type", "application/javascript");
    res.send(metadataJS);
  } catch (error) {
    res.status(500).send(`console.error("Error loading metadata: ${error.message}")`);
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
