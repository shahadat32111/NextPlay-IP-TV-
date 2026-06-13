import express from "express";
import path from "path";
import fs from "fs";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route to fetch and parse M3U
  app.post("/api/fetch-channels", async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      console.log(`Fetching URL: ${url}`);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if (!response.ok) {
        console.error(`Failed to fetch M3U: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to fetch M3U: ${response.statusText}`);
      }
      const text = await response.text();
      console.log(`Fetched ${text.length} characters.`);
      console.log(`Preview: ${text.substring(0, 200)}`);
      
      // Simple validation warning: M3U files usually start with #EXTM3U or contain #EXTINF
      if (!text.includes('#EXTM3U') && !text.includes('#EXTINF')) {
        console.warn('Content does not appear to be a valid M3U file. Content preview:', text.substring(0, 500));
      }

      // Improved M3U parser
      const lines = text.split(/\r?\n/);
      const channels = [];
      let currentMetadata = null;
      let channelCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTM3U')) {
            continue;
        }
        if (line.includes('#EXTINF')) {
          currentMetadata = line;
          continue;
        }
        
        // Match lines that are URLs (http/https/rtmp/etc)
        // Also skip HTML tags that might appear (e.g. <!DOCTYPE html>)
        if (line.length > 0 && !line.startsWith('#') && !line.startsWith('<')) {
          const metadata = currentMetadata || '#EXTINF:-1,Unnamed Channel';
          
          // Improved title extraction
          let title = "Unnamed Channel";
          
          // Remove the #EXTINF:<duration> prefix, keeping the rest of the metadata line
          // Example: #EXTINF:-1 tvg-name="Name" group-title="G",Title
          const metadataContent = metadata.replace(/^#EXTINF:[-0-9]*\s*/, '').trim();

          // 1. Try to extract tvg-name if it exists
          const tvgNameMatch = metadataContent.match(/tvg-name="([^"]+)"/);
          if (tvgNameMatch && tvgNameMatch[1].trim()) {
            title = tvgNameMatch[1].trim();
          } else {
            // 2. Fallback: Try to take the part after the last comma in the metadataContent
            // We assume the title is the last component if there is a comma
            const lastCommaIndex = metadataContent.lastIndexOf(',');
            if (lastCommaIndex !== -1) {
                const potentialTitle = metadataContent.substring(lastCommaIndex + 1).trim();
                if (potentialTitle.length > 0) {
                    title = potentialTitle;
                }
            } else {
                // 3. Fallback: If no comma, use the entire metadata content
                if (metadataContent.length > 0) {
                    title = metadataContent;
                }
            }
          }
          
          const groupMatch = metadata.match(/group-title="([^"]+)"/);
          const logoMatch = metadata.match(/tvg-logo="([^"]+)"/);
          
          channels.push({
            id: Math.random().toString(36).substr(2, 9),
            title: title,
            group: groupMatch ? groupMatch[1].trim() : 'Uncategorized',
            logo: logoMatch ? logoMatch[1] : '',
            url: line,
            rawBlock: `${metadata}\n${line}`
          });
          channelCount++;
          currentMetadata = null;
        }
      }
      if (channelCount === 0) {
          throw new Error("No channels found in playlist");
      }
      
      console.log(`Parsed ${channelCount} channels.`);
      res.json(channels);
    } catch (error) {
      console.error('Error during fetch/parse:', error);
      res.status(500).json({ error: "Failed to fetch or parse M3U playlist" });
    }
  });

  // Serve PWA manifest, service worker and assets with CORS headers explicitly
  const sendAsset = (fileName: string, contentType: string, res: express.Response) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type, Accept");
    res.header("Content-Type", contentType);

    const paths = [
      path.join(process.cwd(), "dist", fileName),
      path.join(process.cwd(), "public", fileName)
    ];

    for (const p of paths) {
      if (fs.existsSync(p)) {
        return res.sendFile(p);
      }
    }
    return res.status(404).send("File not found");
  };

  app.get("/manifest.json", (req, res) => {
    sendAsset("manifest.json", "application/json", res);
  });

  app.get("/sw.js", (req, res) => {
    sendAsset("sw.js", "application/javascript", res);
  });

  app.get("/logo.jpg", (req, res) => {
    sendAsset("logo.jpg", "image/jpeg", res);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
