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

  // Create processed directory if it doesn't exist
  const processedDir = path.join(__dirname, 'processed');
  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  const results = [];
  const processedFilePath = path.join(processedDir, 'processed_file.csv');

  // Add headers as the first row - with correct column order
  results.push(['mobile', 'txn_type', 'bill_number', 'bill_amount', 'points_earned', 'points_redeemed', 'order_time']);

  fs.createReadStream(inputFilePath)
    .pipe(csv())
    .on('data', (row) => {
      try {
        const mobile = row[Object.keys(row)[mobileCol - 1]] || '';
        const billNumber = row[Object.keys(row)[billNumberCol - 1]] || '';
        const billAmount = row[Object.keys(row)[billAmountCol - 1]] || '';
        const orderTime = row[Object.keys(row)[orderTimeCol - 1]] || '';
        // Include all columns in the correct order, with empty values for points
        results.push([
          mobile,           // mobile
          'Purchased',      // txn_type (in 2nd position)
          billNumber,       // bill_number
          billAmount,       // bill_amount
          '',               // points_earned (empty)
          '',               // points_redeemed (empty)
          orderTime         // order_time
        ]);
      } catch (err) {
        console.error('Error processing row:', err);
      }
    })
    .on('end', () => {
      const csvData = results.map(row => row.join(',')).join('\n');
      fs.writeFileSync(processedFilePath, csvData);

      res.json({ success: true, downloadUrl: '/download/processed_file.csv' });
    })
    .on('error', (error) => {
      console.error('Error processing CSV:', error);
      res.status(500).json({ success: false, message: 'Error processing file' });
    });
});

// Download the processed file
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'processed', req.params.filename);
  res.download(filePath);
});

// Create necessary directories
const processedDir = path.join(__dirname, 'processed');
const uploadsDir = path.join(__dirname, 'uploads');

// Create directories if they don't exist
if (!fs.existsSync(processedDir)) {
  fs.mkdirSync(processedDir, { recursive: true });
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});