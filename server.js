const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve static files (CSS)
app.use(express.static('public'));

// Serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Handle file upload
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const filePath = req.file.path;
  res.json({ success: true, filePath });
});

// Process the uploaded file
app.post('/process', express.json(), (req, res) => {
  const { mobileCol, billNumberCol, billAmountCol, orderTimeCol } = req.body;
  const inputFilePath = req.body.filePath;

  const results = [];
  const processedFilePath = path.join(__dirname, 'processed', 'processed_file.csv');

  fs.createReadStream(inputFilePath)
    .pipe(csv())
    .on('data', (row) => {
      const mobile = row[Object.keys(row)[mobileCol - 1]];
      const billNumber = row[Object.keys(row)[billNumberCol - 1]];
      const billAmount = row[Object.keys(row)[billAmountCol - 1]];
      const orderTime = row[Object.keys(row)[orderTimeCol - 1]];
      results.push([mobile, billNumber, billAmount, orderTime, 'Purchased']);
    })
    .on('end', () => {
      const csvData = results.map(row => row.join(',')).join('\n');
      fs.writeFileSync(processedFilePath, csvData);

      res.json({ success: true, downloadUrl: '/download/processed_file.csv' });
    });
});

// Download the processed file
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'processed', req.params.filename);
  res.download(filePath);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});