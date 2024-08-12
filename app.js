const express = require('express');
require('dotenv').config();

const app = express();

const { ScrapOffres } = require('./controller')

// Route to display message
app.get('/', ScrapOffres);
app.get('/test', (req, res) => {
    res.send('Test route is working!');
});

// Start the server
app.listen(process.env.PORT, () => {
    console.log(`Server is running on port http://localhost:${process.env.PORT}`);
});
