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

// Google Drive Folder ID
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// Metadata file path
const METADATA_FILE = "metadata.json";

// 📌 Ensure `metadata.json` exists with predefined sample books
if (!fs.existsSync(METADATA_FILE)) {
  const sampleBooks = [
    {
      title: "Sample Book 1",
      author: "Author 1",
      description: "This is a sample book",
      pdfUrl: "https://example.com/sample1.pdf",
      imageUrl: "https://example.com/sample1.jpg",
      uploadDate: new Date().toISOString(),
    },
    {
      title: "Sample Book 2",
      author: "Author 2",
      description: "This is another sample book",
      pdfUrl: "https://example.com/sample2.pdf",
      imageUrl: "https://example.com/sample2.jpg",
      uploadDate: new Date().toISOString(),
    },
  ];
  fs.writeFileSync(METADATA_FILE, JSON.stringify(sampleBooks, null, 2));
}

// 📌 Function to upload a file to Google Drive
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

    // 📌 Read metadata.json before updating
    let metadata = [];
    if (fs.existsSync(METADATA_FILE)) {
      const rawData = fs.readFileSync(METADATA_FILE, "utf8");
      metadata = rawData ? JSON.parse(rawData) : [];
    }

    // 📌 Add new book entry
    const newBook = {
      title,
      author,
      description,
      pdfUrl: pdfResponse.webContentLink,
      imageUrl: imageResponse.webContentLink,
      uploadDate: new Date().toISOString(),
    };

    metadata.push(newBook);

    // 📌 Write updated metadata.json
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));

    // ✅ Upload updated metadata.json to Google Drive
    const metadataResponse = await uploadToDrive(METADATA_FILE, "metadata.json", "application/json");

    res.json({ message: "Upload successful!", metadataUrl: metadataResponse.webContentLink });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📌 Route to Get All Books from metadata.json
app.get("/api/books", (req, res) => {
  try {
    if (!fs.existsSync(METADATA_FILE)) {
      return res.json([]); // Return empty array if file doesn't exist
    }

    const updatedMetadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));
    res.json(updatedMetadata);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch books" });
  }
});

// 📌 Route to Serve metadata.js Dynamically
app.get("/metadata.js", (req, res) => {
  try {
    if (!fs.existsSync(METADATA_FILE)) {
      return res.send("export const data = [];");
    }

    const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));
    const metadataJS = `export const data = ${JSON.stringify(metadata, null, 2)};`;

    res.setHeader("Content-Type", "application/javascript");
    res.send(metadataJS);
  } catch (error) {
    res.status(500).send(`console.error("Error loading metadata: ${error.message}")`);
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
