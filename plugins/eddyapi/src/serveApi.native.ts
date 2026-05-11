import { createServer, IncomingMessage, ServerResponse } from "http";
import https from "https";

interface ServerConfig {
  port: number;
  secure: boolean;
  apiKey?: string;
}

declare global {
  // Luna bridge
  // eslint-disable-next-line no-var
  var lunaNative: {
    likeTrack?: (trackId: string) => Promise<void> | void;
  };
}

let server: ReturnType<typeof createServer>;
let currentMediaInfo: any = {};

export const updateMediaInfo = (mediaInfo: any) => {
  console.log("received media info:", mediaInfo);
  currentMediaInfo = mediaInfo;
};

let frontendCache: Record<string, string> = {};

/// Cache frontend files
const cacheFrontend = (
  callback: {
    (error: any): void;
    (arg0: Error | null): void;
  },
) => {
  const baseUrl = "eddyviewer.pages.dev";

  const makeRequest = (path: string, cb: any) => {
    const options = {
      hostname: baseUrl,
      path,
      method: "GET",
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        cb(null, data);
      });
    });

    req.on("error", (error) => {
      cb(error);
    });

    req.end();
  };

  // Fetch index.html
  makeRequest("/", (error: any, indexHtmlText: string) => {
    if (error) {
      console.error("Error fetching index.html:", error);
      return callback(error);
    }

    const scriptRegex =
      /<script type="module" crossorigin src="([^"]+)"><\/script>/g;

    const cssRegex =
      /<link rel="stylesheet" crossorigin href="([^"]+)">/g;

    const scriptMatches = scriptRegex.exec(indexHtmlText);
    const cssMatches = cssRegex.exec(indexHtmlText);

    if (!scriptMatches || !cssMatches) {
      return callback(
        new Error("Could not find script or CSS matches"),
      );
    }

    const scriptUrl = scriptMatches[1];
    const cssUrl = cssMatches[1];

    let completed = 0;
    let hasError = false;

    frontendCache["/index.html"] = indexHtmlText;

    const checkComplete = () => {
      completed++;

      if (completed === 2 && !hasError) {
        callback(null);
      }
    };

    // Fetch JS
    makeRequest(scriptUrl, (error: any, scriptText: string) => {
      if (error) {
        hasError = true;
        return callback(error);
      }

      frontendCache[scriptUrl] = scriptText;
      checkComplete();
    });

    // Fetch CSS
    makeRequest(cssUrl, (error: any, cssText: string) => {
      if (error) {
        hasError = true;
        return callback(error);
      }

      frontendCache[cssUrl] = cssText;
      checkComplete();
    });
  });
};

const getFrontendData = (url: string) => {
  return frontendCache[url];
};

const createAPIServer = (config: ServerConfig) => {
  server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      // CORS
      res.setHeader("Access-Control-Allow-Origin", "*");

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS",
      );

      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );

      // OPTIONS
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Auth
      if (config.secure) {
        const authHeader = req.headers.authorization;

        if (
          !authHeader ||
          authHeader !== `Bearer ${config.apiKey}`
        ) {
          res.writeHead(401, {
            "Content-Type": "text/plain",
          });

          res.end("Unauthorized");
          return;
        }
      }

      // =========================
      // HEART / LIKE ENDPOINT
      // =========================
      if (req.method === "POST" && req.url === "/heart") {
        let body = "";

        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", async () => {
          try {
            const parsed = body
              ? JSON.parse(body)
              : {};

            const trackId =
              parsed.trackId ||
              currentMediaInfo?.item?.id;

            if (!trackId) {
              res.writeHead(400, {
                "Content-Type": "application/json",
              });

              res.end(
                JSON.stringify({
                  error: "No trackId",
                }),
              );

              return;
            }

            // Send to Luna / Tidal
            if (global.lunaNative?.likeTrack) {
              await global.lunaNative.likeTrack(
                trackId,
              );

              console.log(
                `[Luna.native] ❤️ Liked track: ${trackId}`,
              );
            } else {
              console.warn(
                "[Luna.native] likeTrack bridge missing",
              );
            }

            res.writeHead(200, {
              "Content-Type": "application/json",
            });

            res.end(
              JSON.stringify({
                success: true,
                trackId,
              }),
            );
          } catch (e: any) {
            console.error(e);

            res.writeHead(500, {
              "Content-Type": "application/json",
            });

            res.end(
              JSON.stringify({
                error:
                  e?.message || "Unknown error",
              }),
            );
          }
        });

        return;
      }

      // =========================
      // NOW PLAYING
      // =========================
      if (
        req.method === "GET" &&
        req.url === "/now-playing"
      ) {
        res.writeHead(200, {
          "Content-Type": "application/json",
        });

        let info = {
          ...currentMediaInfo,
        };

        info.currentTime = Date.now();

        if (!info.paused) {
          info.offset =
            (info.currentTime - info.lastUpdate) /
              1000 +
            0.15;

          info.position =
            info.position + info.offset;

          info.serverCurrentTime =
            info.currentTime;

          info.serverLastUpdate =
            info.lastUpdate;
        }

        res.end(JSON.stringify(info));
        return;
      }

      // =========================
      // HEALTH
      // =========================
      if (
        req.method === "GET" &&
        req.url === "/health"
      ) {
        res.writeHead(200, {
          "Content-Type": "text/plain",
        });

        res.end("OK");
        return;
      }

      // =========================
      // FRONTEND FILES
      // =========================
      if (
        req.method === "GET" &&
        typeof req.url === "string"
      ) {
        if (req.url === "/") {
          req.url = "/index.html";
        }

        const frontendData = getFrontendData(
          req.url,
        );

        let contentType = "text/html";

        if (req.url.endsWith(".css")) {
          contentType = "text/css";
        }

        if (req.url.endsWith(".js")) {
          contentType = "text/javascript";
        }

        if (frontendData) {
          res.writeHead(200, {
            "Content-Type": contentType,
          });

          res.end(frontendData);
          return;
        }
      }

      // 404
      res.writeHead(404, {
        "Content-Type": "text/plain",
      });

      res.end("Not Found");
    },
  );

  server.listen(config.port, () => {
    console.log(
      `Server running on port ${config.port}${
        config.secure
          ? " (secure mode)"
          : ""
      }`,
    );
  });

  return server;
};

export const startServer = (
  config: ServerConfig,
) => {
  if (server) {
    console.log(
      "Server detected, restarting",
    );

    stopServer();
  }

  console.log("Starting server");

  cacheFrontend((error: any) => {
    if (error) {
      console.error(
        "Cache frontend failed:",
        error,
      );

      throw error;
    }

    createAPIServer(config);
  });
};

export const stopServer = () => {
  if (server) {
    server.close(() => {
      console.log("Server stopped");
    });
  }
};
