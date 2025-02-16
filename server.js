import express from "express";
import cors from "cors";
import multer from "multer";
import { google } from "googleapis";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import axios from "axios";

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
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// Google Drive Folder ID (Set in .env)
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// GitHub Repo Config
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_ACCESS_TOKEN = process.env.GITHUB_ACCESS_TOKEN;

// Metadata file locations
const METADATA_FILE = "metadata.json";
const METADATA_JS_FILE = "metadata.js";
const POPULARITY_JSON_FILE = "popularity.json";
const CONTACTS_FILE = "contacts.json";
const INQUIRIES_FILE = "inquiries.json";

const writeInquiries = (inquiries) => {
  fs.writeFileSync(INQUIRIES_FILE, JSON.stringify(inquiries, null, 2), "utf-8");
};
// Ensure metadata.json exists
if (!fs.existsSync(METADATA_FILE)) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(POPULARITY_JSON_FILE)) {
  fs.writeFileSync(POPULARITY_JSON_FILE, JSON.stringify([], null, 2));
}

// ✅ Function to update metadata.js
const updateMetadataJS = () => {
  const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));
  const jsContent = `export const data = ${JSON.stringify(metadata, null, 2)};`;

  fs.writeFileSync("metadata.js", jsContent);
  console.log("✅ metadata.js updated successfully!");
};

// 📌 Function to Get Google Drive File Public URL
const getDriveFileUrl = async (fileId) => {
  try {
    const file = await drive.files.get({
      fileId,
      fields: "webViewLink, webContentLink",
    });
    return file.data.webContentLink;
  } catch (error) {
    console.error("❌ Error fetching Google Drive file:", error);
    return null;
  }
};

// 📌 Upload function to Google Drive
async function uploadToDrive(filePath, fileName, mimeType) {
  const fileMetadata = { name: fileName, parents: [FOLDER_ID] };
  const media = { mimeType, body: fs.createReadStream(filePath) };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: "id",
  });

  const fileId = response.data.id;

  // ✅ Make file public
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  return getDriveFileUrl(fileId);
}

// 📌 Upload Image to GitHub
async function uploadImageToGitHub(imagePath, fileName) {
  const imageData = fs.readFileSync(imagePath, { encoding: "base64" });

  const response = await axios.put(
    `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${fileName}`,
    {
      message: `Add ${fileName}`,
      content: imageData,
      branch: "main",
    },
    {
      headers: {
        Authorization: `token ${GITHUB_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  return response.data.content.download_url;
}

// 📌 Upload Route (PDF + Image + Metadata)
app.post("/upload", upload.fields([{ name: "pdf" }, { name: "image" }]), async (req, res) => {
  try {
    console.log("Received request body:", req.body);
    console.log("Received files:", req.files);

    if (!req.files || !req.files["pdf"] || !req.files["image"]) {
      return res.status(400).json({ error: "PDF or Image file is missing" });
    }

    const { id, name, price, author, description, genre, publishDate } = req.body;
    if (!name || !author) {
      return res.status(400).json({ error: "Name and author are required" });
    }

    const pdf = req.files["pdf"][0];
    const image = req.files["image"][0];

    // ✅ Keep image name exactly the same as `name`
    const imageFileName = `${name}.jpg`;

    // ✅ Move image temporarily to uploads/
    const imagePath = path.join("uploads", imageFileName);
    fs.renameSync(image.path, imagePath);

    // ✅ Upload Image to GitHub
    const imageUrl = await uploadImageToGitHub(imagePath, imageFileName);

    // ✅ Rename and move PDF to uploads/
    const pdfFileName = name.replace(/[^a-zA-Z0-9 ]/g, "_") + ".pdf";
    const pdfPath = `uploads/${pdfFileName}`;
    fs.renameSync(pdf.path, pdfPath);

    // ✅ Upload PDF to Google Drive
    const pdfUrl = await uploadToDrive(pdfPath, pdfFileName, "application/pdf");

    // ✅ Update metadata.json
    const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));
    const newBook = {
      id,
      name,
      author,
      description,
      pdfUrl, // ✅ Use correct Google Drive URL
      price,
      genre,
      availability: true,
      imageUrl, // ✅ Use GitHub image URL
      publishDate,
      uploadDate: new Date().toISOString(),
    };
    metadata.push(newBook);
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));

    // ✅ Update metadata.js
    updateMetadataJS();

    // ✅ Upload updated metadata.json to Google Drive
    // await uploadToDrive(METADATA_FILE, "metadata.json", "application/json");

    res.json({ success: true, message: "Upload successful!", metadata: newBook });
  } catch (error) {
    console.error("❌ Upload Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📌 Route to Get All Books
app.get("/api/books", (req, res) => {
  try {
    const updatedMetadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));
    res.json(updatedMetadata);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch books" });
  }
});

// 📌 Function to Get Public Downloadable Link from Google Drive
async function getPublicDownloadLink(fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" }, // Make it public
    });

    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  } catch (error) {
    console.error("❌ Error generating public link:", error);
    return null;
  }
}

app.get("/api/genres", (req, res) => {
  try {
    const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));
    const genreCount = {};

    metadata.forEach((book) => {
      const genre = book.genre || "Unknown";
      genreCount[genre] = (genreCount[genre] || 0) + 1;
    });

    const genres = Object.entries(genreCount).map(([name, count]) => ({
      name,
      count,
    }));

    res.json(genres);
  } catch (error) {
    console.error("Error fetching genres:", error);
    res.status(500).json({ error: "Failed to fetch genres" });
  }
});


// 📌 Route to Get a Single Book by Name
app.get("/api/books/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const books = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));

    // ✅ Decode name properly
    const decodedName = decodeURIComponent(name);
    const book = books.find((b) => b.name.trim() === decodedName.trim());

    if (!book) {
      return res.status(404).json({ error: "Book not found" });
    }

    if (!book.pdfUrl) {
      return res.status(500).json({ error: "PDF URL missing" });
    }

    // ✅ Convert Google Drive 'view' link to a direct download link
    let pdfUrl = book.pdfUrl;
    const match = pdfUrl.match(/https:\/\/drive\.google\.com\/file\/d\/(.+?)\/view/);

    if (match && match[1]) {
      pdfUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }

    res.json({ ...book, pdfUrl });
  } catch (error) {
    console.error("❌ Fetching Book Error:", error);
    res.status(500).json({ error: "Failed to fetch the book" });
  }
});

// 📌 Function to update the popularity ranking and store in popularity.json
const updatePopularity = () => {
  try {
    const rawData = fs.readFileSync(METADATA_FILE, "utf8");
    const books = JSON.parse(rawData);

    if (!Array.isArray(books)) {
      console.error("Invalid book data format");
      return;
    }

    // Calculate popularity score for each book
    const booksWithPopularity = books.map((book) => ({
      ...book,
      popularityScore: (book.visitCount || 0) * 0.6 + (book.downloadCount || 0) * 0.4,
    }));

    // Sort books by popularity score in descending order
    const sortedBooks = booksWithPopularity
      .sort((a, b) => b.popularityScore - a.popularityScore) // Sort by popularityScore
      .map((book, index) => ({
        ...book,
        popularityRanking: index + 1, // Add a ranking based on popularity
      }));

    // Save the sorted books with popularity scores and rankings to popularity.json
    fs.writeFileSync(POPULARITY_JSON_FILE, JSON.stringify(sortedBooks, null, 2));
    console.log("✅ Popularity ranking updated successfully!");
  } catch (error) {
    console.error("❌ Error updating popularity ranking:", error);
  }
};

// 📌 Route to Increment Visit Count
app.patch("/api/books/:name/increment-visit", async (req, res) => {
  try {
    const { name } = req.params;
    const books = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));

    const decodedName = decodeURIComponent(name);
    const bookIndex = books.findIndex((b) => b.name.trim() === decodedName.trim());

    if (bookIndex === -1) {
      return res.status(404).json({ error: "Book not found" });
    }

    // Increment the visit count
    books[bookIndex].visitCount = (parseInt(books[bookIndex].visitCount, 10) || 0) + 1;

    // Save back to metadata.json
    fs.writeFileSync(METADATA_FILE, JSON.stringify(books, null, 2));

    // Update popularity.json after increment
    updatePopularity();

    res.json({ message: "Visit count updated", visitCount: books[bookIndex].visitCount });
  } catch (error) {
    console.error("❌ Error updating visit count:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/books/:name/ratings", (req, res) => {
  try {
    const bookName = decodeURIComponent(req.params.name);
    const books = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));

    const book = books.find((b) => b.name === bookName);
    if (!book) return res.status(404).json({ error: "Book not found" });

    const avgRating = book.ratings?.length 
      ? (book.ratings.reduce((sum, r) => sum + r, 0) / book.ratings.length).toFixed(1) 
      : "No ratings yet";

    res.json({ avgRating, totalRatings: book.ratings?.length || 0 });
  } catch (error) {
    console.error("Error fetching ratings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/books/:name/rate", express.json(), (req, res) => {
  try {
    const bookName = decodeURIComponent(req.params.name);
    const { rating } = req.body; // Expecting { rating: 4 } from frontend

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Invalid rating. Must be between 1 and 5." });
    }

    let books = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));
    const bookIndex = books.findIndex((b) => b.name === bookName);
    if (bookIndex === -1) return res.status(404).json({ error: "Book not found" });

    books[bookIndex].ratings = books[bookIndex].ratings || [];
    books[bookIndex].ratings.push(rating);

    fs.writeFileSync(METADATA_FILE, JSON.stringify(books, null, 2), "utf8");

    res.json({ message: "Rating submitted successfully" });
  } catch (error) {
    console.error("Error submitting rating:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// 📌 Route to Increment Download Count
app.patch("/api/books/:name/increment-download", async (req, res) => {
  try {
    const { name } = req.params;
    const books = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));

    const decodedName = decodeURIComponent(name);
    const bookIndex = books.findIndex((b) => b.name.trim() === decodedName.trim());

    if (bookIndex === -1) {
      return res.status(404).json({ error: "Book not found" });
    }

    // Increment the download count
    books[bookIndex].downloadCount = (parseInt(books[bookIndex].downloadCount, 10) || 0) + 1;

    // Save back to metadata.json
    fs.writeFileSync(METADATA_FILE, JSON.stringify(books, null, 2));

    // Update popularity.json after increment
    updatePopularity();

    res.json({ message: "Download count updated", downloadCount: books[bookIndex].downloadCount });
  } catch (error) {
    console.error("❌ Error updating download count:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/inquiries", (req, res) => {
  const { name, email, inquiryType, message } = req.body;

  // Validate request data
  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email, and message are required" });
  }

  const newInquiry = {
    id: Date.now(),
    name,
    email,
    inquiryType,
    message,
    date: new Date().toISOString(),
  };

  try {
    const inquiries = readInquiries();
    inquiries.push(newInquiry);
    writeInquiries(inquiries);

    res.status(201).json({ message: "Inquiry submitted successfully", inquiry: newInquiry });
  } catch (error) {
    console.error("Error saving inquiry:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// 📌 Route to Serve metadata.js Dynamically
app.get("/metadata.js", (req, res) => {
  try {
    if (!fs.existsSync(METADATA_JS_FILE)) {
      return res.status(404).send("console.error('metadata.js not found');");
    }
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(path.resolve(METADATA_JS_FILE));
  } catch (error) {
    res.status(500).send(`console.error("Error loading metadata: ${error.message}")`);
  }
});
// 📌 Route to Get Popular Books
app.get("/api/popular-books", (req, res) => {
  try {
    const popularBooksData = fs.readFileSync(POPULARITY_JSON_FILE, "utf8");
    const popularBooks = JSON.parse(popularBooksData);
    
    if (popularBooks.length === 0) {
      return res.status(404).json({ error: "No popular books found" });
    }

    res.setHeader("Content-Type", "application/json");  // Ensure response is JSON
    res.json(popularBooks);
  } catch (error) {
    console.error("Error fetching popular books:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


const PORT =process.env.PORT|| 8000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
