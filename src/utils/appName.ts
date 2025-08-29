/**
 * Get the application name from environment variables with fallback
 */
export function getAppName(): string {
  return import.meta.env.VITE_APP_NAME || "P-Stream";
}

/**
 * Get the application domain from environment variables with fallback
 */
export function getAppDomain(): string {
  return import.meta.env.VITE_APP_DOMAIN || "https://pstream.org";
}

export function getDiscordUrl(): string {
  return import.meta.env.VITE_DISCORD_URL || "https://discord.gg/7z6znYgrTG";
}

export function getGithubUrl(): string {
  return (
    import.meta.env.VITE_GITHUB_URL || "https://github.com/p-stream/p-stream"
  );
}

export function getFebboxUrl(): string {
  return import.meta.env.VITE_FEBBOX_URL || "https://febbox.com";
}

export function getDocsUrl(): string {
  return import.meta.env.VITE_DOCS_URL || "https://docs.pstream.mov";
}

export function getRealDebridUrl(): string {
  return import.meta.env.VITE_REAL_DEBRID_URL || "https://real-debrid.com";
}

/**
 * Get the application name for page titles
 */
export function getPageTitle(title?: string): string {
  const appName = getAppName();
  return title ? `${title} - ${appName}` : appName;
}
