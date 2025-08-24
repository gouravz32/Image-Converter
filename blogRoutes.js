const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Blog index page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'blog', 'index.html'));
});

// Individual blog posts
router.get('/:slug', (req, res) => {
  const { slug } = req.params;
  const blogFile = path.join(__dirname, 'public', 'blog', `${slug}.html`);
  
  if (fs.existsSync(blogFile)) {
    res.sendFile(blogFile);
  } else {
    res.redirect('/blog');
  }
});

module.exports = router;