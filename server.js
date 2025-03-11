const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx'); // Added for Excel support


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
  // Determine file type from original filename
  const originalExt = path.extname(req.file.originalname).toLowerCase();
  const fileType = (originalExt === '.csv') ? 'csv' : 
                  ((originalExt === '.xlsx' || originalExt === '.xls') ? 'excel' : 'unknown');
  
  res.json({ 
    success: true, 
    filePath, 
    fileType 
  });
});

// Process the uploaded file
app.post('/process', express.json(), (req, res) => {
  const { mobileCol, billNumberCol, billAmountCol, orderTimeCol, pointsEarnedCol, pointsRedeemedCol, filePath, fileType } = req.body;
  const inputFilePath = filePath;

  // Create processed directory if it doesn't exist
  const processedDir = path.join(__dirname, 'processed');
  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  const results = [];
  const processedFilePath = path.join(processedDir, 'processed_file.csv');

  // Add headers as the first row - with correct column order
  results.push(['mobile', 'txn_type', 'bill_number', 'bill_amount', 'order_time', 'points_earned', 'points_redeemed']);

  try {
    if (fileType === 'csv') {
      // Process CSV file
      const csvRows = [];
      fs.createReadStream(inputFilePath)
        .pipe(csv())
        .on('data', (row) => {
          csvRows.push(row);
        })
        .on('end', () => {
          if (csvRows.length === 0) {
            return res.status(400).json({ success: false, message: 'CSV file is empty' });
          }
          
          // Process all rows after the header
          csvRows.forEach(row => {
            processRow(row, results);
          });
          
          // Ensure first and second rows are not empty
          if (results.length <= 1) {
            return res.status(400).json({ 
              success: false, 
              message: 'Not enough data rows after processing. File must contain a header row and at least one data row.' 
            });
          }
          
          writeResultsAndRespond();
        })
        .on('error', (error) => {
          console.error('Error processing CSV:', error);
          res.status(500).json({ success: false, message: 'Error processing CSV file' });
        });
    } else if (fileType === 'excel') {
      // Process Excel file
      const workbook = xlsx.readFile(inputFilePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
      
      if (data.length <= 1) {
        return res.status(400).json({ success: false, message: 'Excel file is empty or has only headers' });
      }
      
      // Process each data row after the header
      for (let i = 1; i < data.length; i++) {
        const rowArray = data[i];
        if (rowArray.length > 0) {
          // Convert array row to object with indexed values to match CSV row format
          const rowObj = {};
          rowArray.forEach((val, index) => {
            rowObj[index] = val !== undefined ? val.toString() : '';
          });
          
          processRow(rowObj, results);
        }
      }
      
      // Ensure we have at least one data row after processing
      if (results.length <= 1) {
        return res.status(400).json({ 
          success: false, 
          message: 'Not enough data rows after processing. File must contain a header row and at least one data row.' 
        });
      }
      
      writeResultsAndRespond();
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported file type' });
    }
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ success: false, message: `Error processing file: ${error.message}` });
  }

  // Function to process a row of data
  function processRow(row, results) {
    try {
      // Get values using column numbers (supporting both array and object format)
      const getColumnValue = (row, colNum) => {
        if (!colNum) return '';
        
        // Handle both object with numeric keys and arrays
        if (Array.isArray(row)) {
          return colNum <= row.length ? (row[colNum - 1] || '') : '';
        } else if (typeof row === 'object') {
          // Try to get value from object using column number as key or index
          const keys = Object.keys(row);
          const numColIndex = colNum - 1;
          
          // First try direct access using column number
          if (row[numColIndex] !== undefined) {
            return row[numColIndex].toString();
          }
          
          // Then try using the corresponding key at that index
          if (keys.length > numColIndex) {
            return row[keys[numColIndex]].toString();
          }
          
          return '';
        }
        return '';
      };

      // Extract values
      const mobile = getColumnValue(row, parseInt(mobileCol)) || '';
      let billNumber = getColumnValue(row, parseInt(billNumberCol)) || '';
      let billAmount = getColumnValue(row, parseInt(billAmountCol)) || '';
      const orderTime = getColumnValue(row, parseInt(orderTimeCol)) || '';
      let pointsEarned = pointsEarnedCol ? (getColumnValue(row, parseInt(pointsEarnedCol)) || '') : '';
      let pointsRedeemed = pointsRedeemedCol ? (getColumnValue(row, parseInt(pointsRedeemedCol)) || '') : '';
      
      // Validate bill number is numeric, if not empty
      if (billNumber && isNaN(Number(billNumber))) {
        billNumber = '';
      }
      
      // Validate bill amount is numeric, if not empty
      if (billAmount && isNaN(Number(billAmount))) {
        billAmount = '';
      }
      
      // Check if row has any data (at least one field has a value)
      if (!mobile && !billNumber && !billAmount && !orderTime && !pointsEarned && !pointsRedeemed) {
        // Skip empty row
        return;
      }
      
      // Create row data with "purchase" in lowercase, only if row has data
      const rowData = [
        mobile,                             // mobile (1)
        mobile || billNumber || billAmount || orderTime || pointsEarned || pointsRedeemed ? 'purchase' : '', // txn_type (2)
        billNumber,                         // bill_number (3)
        billAmount,                         // bill_amount (4)
        orderTime,                          // order_time (5)
        pointsEarned,                       // points_earned (6)
        pointsRedeemed                      // points_redeemed (7)
      ];
      
      results.push(rowData);
    } catch (err) {
      console.error('Error processing row:', err);
    }
  }

  // Function to write results and send response
  function writeResultsAndRespond() {
    const csvData = results.map(row => row.join(',')).join('\n');
    fs.writeFileSync(processedFilePath, csvData);
    
    res.json({ success: true, downloadUrl: '/download/processed_file.csv' });
  }
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