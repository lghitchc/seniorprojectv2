const express = require('express');
const mysql = require('mysql2/promise'); // Modified import to use promise API
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs');
const multer = require('multer'); // For handling file uploads
const path = require('path');

// Express
const app = express();

// Enable CORS
app.use(cors());
app.options('/api/users', cors());

// Static files
app.use(express.static('public'));

// Define storage settings for multer
const storage = multer.diskStorage({
  destination: 'uploads/', // Specify the directory for storing uploaded files
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const originalName = path.basename(file.originalname, path.extname(file.originalname)); // Remove extension
    const ext = path.extname(file.originalname);
    cb(null, `${originalName}-${uniqueSuffix}${ext}`);
  }
});

// Initialize multer with custom storage settings
const upload = multer({ storage: storage });

// Parse JSON
app.use(bodyParser.json());

// Initialize session middleware
app.use(session({
  secret: process.env.SECRET_SESSION_KEY, // Set your secret key for session encryption
  resave: false,
  saveUninitialized: false
}));

// Amazon RDS Connection
const pool = mysql.createPool({
  user: process.env.RDS_USERNAME, // RDS username
  host: process.env.RDS_HOSTNAME, // RDS endpoint
  database: process.env.RDS_DB_NAME, // RDS database name
  password: process.env.RDS_PASSWORD, // RDS password
  port: process.env.RDS_PORT, // RDS port, usually 3306
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test the connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error('Database connection failed:', err);
  } else {
    console.log('Connected to the database!');
    connection.release();
  }
});

// Removed the promise() call as mysql2 now supports promises by default
// No need for promisePool, using pool directly

// Define API endpoint to create a new user
app.post('/api/signup', upload.single('image'), async (req, res) => {
  const { username, email, password, age, gender, location } = req.body;
  const image = req.file ? req.file.path : null; // Store image path if uploaded

  try {
    // Insert new user into the database
    const [userResult] = await pool.query('INSERT INTO Users (Username, Email, Password, Age, Gender, Location) VALUES (?, ?, ?, ?, ?, ?) RETURNING UserID',
      [username, email, password, age, gender, location]);

    const userId = userResult.insertId;

    // Insert image data into the Images table
    if (image) {
      try {
        // Read the file synchronously
        const data = fs.readFileSync(image);

        // Insert image data into the Images table
        const [imageResult] = await pool.query('INSERT INTO Images (ImageData, user_id) VALUES (?, ?)', [data, userId]);
        console.log('Image ID:', imageResult.insertId);
        const imageId = imageResult.insertId;

        // Update the Users table with the image ID
        await pool.query('UPDATE Users SET ImageID = ? WHERE UserID = ?', [imageId, userId]);

        // Redirect to connectnest.html upon successful account creation
        res.redirect('https://seniorprojectv2.vercel.app/connectnest.html');
      } catch (err) {
        console.error('Error creating account', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    } else {
      // Redirect to connectnest.html upon successful account creation
      res.redirect('https://seniorprojectv2.vercel.app/connectnest.html');
    }


  } catch (err) {
    console.error('Error creating account', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Define API endpoint to authenticate user
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Query database to validate user credentials
    const [result] = await pool.query('SELECT * FROM users WHERE email = ? AND password = ?', [email, password]);

    if (result.length === 1) {
      // User authenticated, create session and store userId
      req.session.userID = result[0].userid;
      req.session.username = result[0].username;
      res.status(200).json({ success: true, message: 'Login successful', userId: req.session.userID, username: req.session.username });
    } else {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
    }
  } catch (err) {
    console.error('Error authenticating user', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Define API endpoint to handle profile update
app.post('/api/profile', upload.single('image'), async (req, res) => {
  console.log('Uploaded file:', req.file); // Log uploaded file
  const { username, bio } = req.body;
  let image = req.file ? req.file.path : null; // Store image path if uploaded

  try {
    // If an image is uploaded, process it
    if (image) {
      //Check if file exists
      if (fs.existsSync(image)){
      // Read the image file synchronously
      const data = fs.readFileSync(image);
      console.log('Image Data:', data);

      try {
        // Insert image data into the Images table along with user_id
        const [imageResult] = await pool.query('INSERT INTO Images (ImageData, user_id) VALUES (?, ?)', [data, req.session.userID]);
      
        // Log the image ID obtained from the result
        console.log('Image Result:', imageResult);
      
        const imageId = imageResult.insertId; // Get the image ID from the result
        console.log('Image ID:', imageId); // Log the image ID obtained from the result
      
        // Update the user profile with the new image ID
        await pool.query('UPDATE users SET username = ?, bio = ?, image = ? WHERE userid = ?', [username, bio, imageId, req.session.userID]);
      } catch (error) {
        console.error('Error inserting image data:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
        return;
      }      
    } else {
      // If no image is uploaded, update the user profile without changing the profile picture path
      await pool.query('UPDATE users SET username = ?, bio = ? WHERE userid = ?', [username, bio, req.session.userID]);
    }
  }
    // If the profile update was successful, send a success response
    res.status(200).json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Define API endpoint to fetch users with images
app.get('/api/users', async (req, res) => {
  try {
      const loggedInUserId = req.session.userID;

      console.log('Logged-in user ID:', loggedInUserId);

      // Query to fetch user data including profile pictures
      const [rows] = await pool.query('SELECT u.userid, u.username, u.age, u.location, u.gender, i.imageid, i.imagedata FROM users u LEFT JOIN Images i ON u.userid = i.user_id');

      console.log('Image Data:', rows.map(row => row.imagedata));

      // Map fetched rows to user objects with profile picture paths
      const users = rows.map(row => ({
          userID: row.userid, // Add userID field to the user object
          username: row.username,
          age: row.age,
          location: row.location,
          gender: row.gender,
          image: row.imagedata ? `data:image/jpeg;base64,${Buffer.from(row.imagedata).toString('base64')}` : null
      }));

      console.log('Base64 Encoded Image Data:', users.map(user => user.image));

      // Filter out the logged-in user's data
      const filteredUsers = users.filter(user => user.userID !== loggedInUserId);

      console.log('Filtered User Data:', filteredUsers);

      // Set the Content-Type header
      res.header('Content-Type', 'application/json');

      // Send filtered user data to the client
      res.json(filteredUsers);
  } catch (err) {
      console.error('Error fetching users', err);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Define API endpoint to handle liking a user
app.post('/api/like', async (req, res) => {
  const { likerId, likedId } = req.body;

  try {
    // Check if the liked user likes the liker back
    const [likedUserLikesLiker] = await pool.query(
      'SELECT * FROM Friendships WHERE (User1ID = ? AND User2ID = ?) OR (User1ID = ? AND User2ID = ?)',
      [likerId, likedId, likedId, likerId]
    );

    // Check if the liker user likes back
    const [likerUserLikesLiked] = await pool.query(
      'SELECT * FROM Friendships WHERE User1ID = ? AND User2ID = ? AND Status = ?',
      [likerId, likedId, 'Accepted']
    );

    // Update friendship status based on the like operation
    if (likedUserLikesLiker.length > 0) {
      // Users like each other, set friendship status to "Accepted"
      await pool.query(
        'UPDATE Friendships SET Status = ? WHERE (User1ID = ? AND User2ID = ?) OR (User1ID = ? AND User2ID = ?)',
        ['Accepted', likerId, likedId, likedId, likerId]
      );
      res.status(200).json({ success: true, message: 'Liked user successfully', likedBack: true });
    } else {
      // Liked user hasn't liked back yet, set friendship status to "Pending"
      await pool.query(
        'INSERT INTO Friendships (User1ID, User2ID, Status) VALUES (?, ?, ?)',
        [likerId, likedId, 'Pending']
      );
      res.status(200).json({ success: true, message: 'Liked user successfully', likedBack: false });
    }
  } catch (error) {
    console.error('Error liking user:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Define API endpoint to fetch user friendships
app.get('/api/friendships/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    // Fetch friendships for the specified user
    const [friendships] = await pool.query(
      'SELECT u.UserID, u.Username, u.Age, u.Location, u.Gender, f.Status FROM Users u INNER JOIN Friendships f ON (u.UserID = f.User1ID OR u.UserID = f.User2ID) WHERE ((f.User1ID = ? AND f.User2ID != ?) OR (f.User2ID = ? AND f.User1ID != ?)) AND f.Status = ?',
      [userId, userId, userId, userId, 'Accepted']
    );

    res.status(200).json({ success: true, friendships: friendships });
  } catch (error) {
    console.error('Error fetching user friendships:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Define API endpoint to fetch sender ID
app.get('/api/get-sender-id', async (req, res) => {
  const { username } = req.query;
  if (!username) {
    res.status(400).json({ success: false, error: 'Username is required' });
    return;
  }

  try {
    // Query the database to get the sender ID based on the username
    const [sender] = await pool.query('SELECT UserID AS senderId FROM Users WHERE Username = ?', [username]);

    if (sender.length > 0) {
      res.status(200).json({ success: true, senderId: sender[0].senderId });
    } else {
      res.status(404).json({ success: false, error: 'Sender not found' });
    }
  } catch (error) {
    console.error('Error fetching sender ID:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Define API endpoint to fetch receiver ID
app.get('/api/get-receiver-id', async (req, res) => {
  const { receiverUsername } = req.query; // Change parameter name to receiverUsername
  console.log('Received receiverUsername:', receiverUsername);
  if (!receiverUsername) {
    res.status(400).json({ success: false, error: 'Receiver username is required' }); // Update error message
    return;
}

  try {
    // Query the database to get the receiver ID based on the username
    console.log('Fetching receiver ID for username:', receiverUsername);
    const [receiver] = await pool.query('SELECT UserID AS receiverId FROM Users WHERE Username = ?', [receiverUsername]);
    console.log('Database Query Result:', receiver);

    if (receiver && receiver.length > 0) {
      res.status(200).json({ success: true, receiverId: receiver[0].receiverId });
    } else {
      res.status(404).json({ success: false, error: 'Receiver not found' });
    }
  } catch (error) {
    console.error('Error fetching receiver ID:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Define API endpoint to send a message
app.post('/api/send-message', async (req, res) => {

  const { senderUsername, receiverUsername, content } = req.body;
  const loggedInUser = req.session.username; // Retrieve username from session
  const senderId = req.session.userID; // Retrieve userID from session

  try {
    console.log('Received senderUsername:', senderUsername);
    console.log('Received receiverUsername:', receiverUsername);
    console.log('Received content:', content);

    // Query the database to get the receiverId based on the receiverUsername
    console.log('Querying database for receiver ID...');
    const result = await pool.query('SELECT UserID AS receiverId FROM Users WHERE Username = ?', [receiverUsername]);
    console.log('Database Query Result:', result); // Log the result of the database query

    if (result[0].length > 0) {
      const [{ receiverId }] = result[0]; // Destructure receiverId if result contains rows
      console.log('Receiver ID:', receiverId);

      // Check if there's an existing friendship between sender and receiver
      console.log('Checking for friendship...');
      const [friendship] = await pool.query(
        'SELECT * FROM Friendships WHERE ((User1ID = ? AND User2ID = ?) OR (User1ID = ? AND User2ID = ?)) AND Status = ?',
        [senderId, receiverId, receiverId, senderId, 'Accepted']
      );
    
      console.log('Friendship:', friendship); // Log the result of the friendship query

      if (friendship.length > 0) {
        // Insert the message into the database
        const query = 'INSERT INTO Messages (SenderID, ReceiverID, Content) VALUES (?, ?, ?)';
        await pool.query(query, [senderId, receiverId, content]);
        res.status(200).json({ success: true, message: 'Message sent successfully' });
      } else {
        res.status(403).json({ success: false, error: 'You can only send messages to friends' });
      }
    } else {
      console.error('Receiver ID is undefined'); // Log an error if receiverId is undefined
      res.status(404).json({ success: false, error: 'Receiver not found' });
    }
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


// Define API endpoint to fetch messages between two users
app.get('/api/messages', async (req, res) => {
  const { senderUsername, receiverUsername } = req.query;

  try {
    // Fetch messages between sender and receiver
    const [messages] = await pool.query(
      'SELECT m.*, s.username AS senderUsername, r.username AS receiverUsername FROM Messages m ' +
      'INNER JOIN Users s ON m.SenderID = s.UserID ' +
      'INNER JOIN Users r ON m.ReceiverID = r.UserID ' +
      'WHERE (s.username = ? AND r.username = ?) OR (s.username = ? AND r.username = ?) ORDER BY m.Timestamp',
      [senderUsername, receiverUsername, receiverUsername, senderUsername]
    );

    res.status(200).json({ success: true, messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


// Define API endpoint to logout user
app.post('/api/logout', (req, res) => {
  req.session.destroy(); // Destroy session on logout
  res.status(200).json({ success: true, message: 'Logout successful' });
});

// Start server
const PORT = process.env.RDS_PORT || 3050;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
