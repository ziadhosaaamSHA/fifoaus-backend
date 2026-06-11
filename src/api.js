import "dotenv/config";
import { createContentApiApp } from "./services/content/apiApp.js";

const port = Number(process.env.PORT || 3000);
const app = createContentApiApp();

app.listen(port, () => {
  console.log(`[content-api] listening on :${port}`);
});
