const express = require('express');
const router = express.Router();
const { GeneratedContent } = require('../db');

router.get('/sitemap.xml', async (req, res) => {
    try {
        const images = await GeneratedContent.findAll({
            where: { type: 'image', isPublic: true },
            attributes: ['id', 'contentUrl', 'prompt', 'updatedAt']
        });
        res.header('Content-Type', 'application/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>