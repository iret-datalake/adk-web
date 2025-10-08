const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4200;

// Serve static files from the Angular dist directory
app.use(express.static(path.join(__dirname, 'dist/agent_framework_web/browser')));

// Redirect all other routes to the Angular app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/agent_framework_web/browser/index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});