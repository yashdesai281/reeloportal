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
  // Store original filename to later retrieve it for contacts processing
  const originalName = req.file.originalname;
  // Determine file type from original filename
  const originalExt = path.extname(req.file.originalname).toLowerCase();
  const fileType = (originalExt === '.csv') ? 'csv' : 
                  ((originalExt === '.xlsx' || originalExt === '.xls') ? 'excel' : 'unknown');

  res.json({ 
    success: true, 
    filePath, 
    fileType,
    originalName
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

    res.json({ 
      success: true, 
      downloadUrl: '/download/processed_file.csv', 
      originalFilePath: inputFilePath, 
      fileType: fileType,
      promptContacts: true // Added flag to indicate contacts processing should be prompted
    });
  }
});

// Process contacts from the same file
app.post('/process-contacts', express.json(), (req, res) => {
  const { filePath, fileType, columnMapping } = req.body;
  const inputFilePath = filePath;

  // Create processed directory if it doesn't exist
  const processedDir = path.join(__dirname, 'processed');
  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  const results = [];
  const processedFilePath = path.join(processedDir, 'contacts_file.csv');

  // Add headers as the first row - with correct column order for contacts
  results.push(['phone_number', 'name', 'email', 'birthday', 'anniversary', 'gender', 'points', 'tags']);

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
          const processedMobiles = new Set(); // For duplicate management
          csvRows.forEach(row => {
            processContactRow(row, results, processedMobiles, columnMapping);
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
      const processedMobiles = new Set(); // For duplicate management
      for (let i = 1; i < data.length; i++) {
        const rowArray = data[i];
        if (rowArray.length > 0) {
          // Convert array row to object with indexed values to match CSV row format
          const rowObj = {};
          rowArray.forEach((val, index) => {
            rowObj[index] = val !== undefined ? val.toString() : '';
          });

          processContactRow(rowObj, results, processedMobiles, columnMapping);
        }
      }

      // Ensure we have at least one data row after processing
      if (results.length <= 1) {
        return res.status(400).json({ 
          success: false, 
          message: 'Not enough data rows after processing for contacts. File must contain a header row and at least one data row.' 
        });
      }

      writeResultsAndRespond();
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported file type' });
    }
  } catch (error) {
    console.error('Error processing contacts file:', error);
    res.status(500).json({ success: false, message: `Error processing contacts file: ${error.message}` });
  }

  // Function to process a contact row with data cleaning
  function processContactRow(row, results, processedMobiles, columnMapping) {
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

      // Intelligent column mapping - if no columns provided, try to detect them automatically
      if (!columnMapping.phoneCol || Object.values(columnMapping).every(val => !val)) {
        const headers = Object.keys(row);
        const headerValues = Array.isArray(row) ? [] : Object.values(row);
        
        // Try to find column indexes based on common names
        for (let i = 0; i < headers.length; i++) {
          const header = (headers[i] || '').toString().toLowerCase();
          const value = headerValues[i] || '';
          
          if (!columnMapping.phoneCol && 
              (header.includes('phone') || header.includes('mobile') || header.includes('contact'))) {
            columnMapping.phoneCol = (i + 1).toString();
          } else if (!columnMapping.nameCol && 
              (header.includes('name') || header.includes('customer'))) {
            columnMapping.nameCol = (i + 1).toString();
          } else if (!columnMapping.emailCol && 
              (header.includes('email') || header.includes('mail'))) {
            columnMapping.emailCol = (i + 1).toString();
          } else if (!columnMapping.birthdayCol && 
              (header.includes('birth') || header.includes('dob'))) {
            columnMapping.birthdayCol = (i + 1).toString();
          } else if (!columnMapping.anniversaryCol && 
              (header.includes('anniversary') || header.includes('anniv'))) {
            columnMapping.anniversaryCol = (i + 1).toString();
          } else if (!columnMapping.genderCol && 
              (header.includes('gender') || header.includes('sex'))) {
            columnMapping.genderCol = (i + 1).toString();
          } else if (!columnMapping.pointsCol && 
              (header.includes('point') || header.includes('score'))) {
            columnMapping.pointsCol = (i + 1).toString();
          } else if (!columnMapping.tagsCol && 
              (header.includes('tag') || header.includes('category') || header.includes('group'))) {
            columnMapping.tagsCol = (i + 1).toString();
          }
        }
      }

      // Extract values using mapping
      let phoneNumber = getColumnValue(row, parseInt(columnMapping.phoneCol || 0)) || '';
      let name = getColumnValue(row, parseInt(columnMapping.nameCol || 0)) || '';
      let email = getColumnValue(row, parseInt(columnMapping.emailCol || 0)) || '';
      let birthday = getColumnValue(row, parseInt(columnMapping.birthdayCol || 0)) || '';
      let anniversary = getColumnValue(row, parseInt(columnMapping.anniversaryCol || 0)) || '';
      let gender = getColumnValue(row, parseInt(columnMapping.genderCol || 0)) || '';
      let points = getColumnValue(row, parseInt(columnMapping.pointsCol || 0)) || '';
      let tags = getColumnValue(row, parseInt(columnMapping.tagsCol || 0)) || '';

      // DATA CLEANING

      // Phone Number Standardization
      phoneNumber = standardizePhoneNumber(phoneNumber);

      // Skip if no phone number or already processed (duplicate management)
      if (!phoneNumber || processedMobiles.has(phoneNumber)) {
        return;
      }

      // Add to processed set for duplicate management
      processedMobiles.add(phoneNumber);

      // Name Cleaning
      name = cleanName(name);

      // Email cleaning - special handling to maintain proper format
      email = cleanEmail(email);

      // Date Formatting - birthday
      birthday = standardizeDate(birthday);

      // Date Formatting - anniversary
      anniversary = standardizeDate(anniversary);

      // Gender Cleaning - remove special chars and standardize
      gender = cleanGender(gender);

      // Points Formatting
      points = formatPoints(points);

      // Tags cleaning - basic cleaning while preserving useful information
      tags = cleanTags(tags);

      // Create row data
      const rowData = [
        phoneNumber,  // phone_number
        name,         // name
        email,        // email
        birthday,     // birthday
        anniversary,  // anniversary
        gender,       // gender
        points,       // points
        tags          // tags
      ];

      results.push(rowData);
    } catch (err) {
      console.error('Error processing contact row:', err);
    }
  }

  // Function to standardize phone number
  function standardizePhoneNumber(phone) {
    if (!phone) return '';

    // Convert to string if not already
    phone = phone.toString();
    
    // Remove common prefixes like +91, 91, 0091, etc.
    phone = phone.replace(/^(\+91|91|0091)/, '');

    // Remove all non-numeric characters (spaces, dashes, parentheses, etc.)
    phone = phone.replace(/\D/g, '');

    // Ensure consistent format (no specific format required, just clean number)
    return phone;
  }

  // Function to clean name
  function cleanName(name) {
    if (!name) return '';

    // Convert to string if not already
    name = name.toString();
    
    // Remove special characters except spaces, hyphens, and apostrophes
    name = name.replace(/[^\w\s\-']/g, '');

    // Trim extra spaces, including multiple spaces between words
    name = name.replace(/\s+/g, ' ').trim();

    // Capitalize the first letter of each word
    name = name.replace(/\b\w/g, char => char.toUpperCase());

    return name;
  }

  // Function to clean email
  function cleanEmail(email) {
    if (!email) return '';

    // Convert to string if not already
    email = email.toString();
    
    // Basic email cleaning - trim and lowercase
    email = email.trim().toLowerCase();

    // Preserve valid email format, only remove extra spaces
    email = email.replace(/\s+/g, '');

    // Validate basic email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      // If not valid, return empty string
      return '';
    }

    return email;
  }

  // Function to standardize date
  function standardizeDate(date) {
    if (!date) return '';

    // Convert to string if not already
    date = date.toString();
    
    // Check if it's a numeric timestamp
    if (!isNaN(date) && date.length >= 8) {
      // Try to parse as timestamp
      const timestamp = parseInt(date);
      const parsedDate = new Date(timestamp);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.toISOString().split('T')[0]; // YYYY-MM-DD
      }
    }

    // Remove any non-date characters but keep separators
    const cleanDate = date.replace(/[^\d/\-\.]/g, '');

    // Try different date formats
    let parsedDate;

    // Try DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}$/.test(cleanDate)) {
      const parts = cleanDate.split(/[\/\-\.]/);
      parsedDate = new Date(`${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`);
    } 
    // Try MM/DD/YYYY or MM-DD-YYYY or MM.DD.YYYY
    else if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}$/.test(cleanDate)) {
      const parts = cleanDate.split(/[\/\-\.]/);
      parsedDate = new Date(`${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`);
    }
    // Try YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD
    else if (/^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$/.test(cleanDate)) {
      const parts = cleanDate.split(/[\/\-\.]/);
      parsedDate = new Date(`${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`);
    }
    // Try YYYYMMDD format (without separators)
    else if (/^\d{8}$/.test(cleanDate)) {
      const year = cleanDate.substring(0, 4);
      const month = cleanDate.substring(4, 6);
      const day = cleanDate.substring(6, 8);
      parsedDate = new Date(`${year}-${month}-${day}`);
    }

    // Check if date is valid
    if (parsedDate && !isNaN(parsedDate.getTime())) {
      // Format as YYYY-MM-DD
      return parsedDate.toISOString().split('T')[0];
    }

    // Flag invalid date by returning empty string
    return '';
  }

  // Function to clean gender
  function cleanGender(gender) {
    if (!gender) return '';

    // Convert to string if not already
    gender = gender.toString();
    
    // Remove special characters and extra spaces
    gender = gender.replace(/[^\w\s]/g, '').trim().toLowerCase();

    // Standardize common gender values
    if (['m', 'male', 'man', 'boy', 'gent', 'gentleman', 'sir'].includes(gender)) {
      return 'Male';
    } else if (['f', 'female', 'woman', 'girl', 'lady', 'madam'].includes(gender)) {
      return 'Female';
    } else if (['o', 'other', 'non-binary', 'nonbinary', 'nb', 'neutral', 'n'].includes(gender)) {
      return 'Other';
    }

    // Return original value with first letter capitalized
    return gender.charAt(0).toUpperCase() + gender.slice(1);
  }

  // Function to format points
  function formatPoints(points) {
    if (!points) return '0';

    // Convert to string if not already
    points = points.toString();
    
    // Handle potential float values (e.g., "100.0")
    if (points.includes('.')) {
      points = parseFloat(points).toString();
    }

    // Remove all non-numeric characters
    points = points.replace(/[^\d-]/g, '');

    // Convert to integer if possible
    if (points.length > 0) {
      return parseInt(points, 10).toString();
    }

    // Default to 0 if invalid or empty
    return '0';
  }

  // Function to clean tags
  function cleanTags(tags) {
    if (!tags) return '';

    // Convert to string if not already
    tags = tags.toString();
    
    // Basic cleaning - remove extra spaces and special characters
    tags = tags.replace(/\s+/g, ' ').trim();
    
    // Keep commas as tag separators, but clean other special characters
    tags = tags.replace(/[^\w\s,\-]/g, '');

    return tags;
  }

  // Function to write results and send response
  function writeResultsAndRespond() {
    const csvData = results.map(row => row.join(',')).join('\n');
    fs.writeFileSync(processedFilePath, csvData);

    res.json({
      success: true,
      downloadUrl: '/download/contacts_file.csv',
      totalContacts: results.length - 1, // Subtract header row
    });
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