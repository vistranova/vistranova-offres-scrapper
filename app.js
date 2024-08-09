const express = require('express');

const app = express();
const PORT = 1234

const { ScrapOffres } = require('./controller')

// Route to display message
app.get('/', ScrapOffres);

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
});
