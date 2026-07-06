from app.config import Settings


def build_web_manifest(settings: Settings) -> dict[str, object]:
    base_url = settings.app_base_url.rstrip("/")
    return {
        "background_color": "#fff7ed",
        "description": "A personal Cooklang recipe collection.",
        "display": "standalone",
        "icons": [
            {
                "purpose": "any",
                "sizes": "192x192",
                "src": "/web-app-icon-192.png",
                "type": "image/png",
            },
            {
                "purpose": "maskable",
                "sizes": "192x192",
                "src": "/web-app-icon-192.png",
                "type": "image/png",
            },
            {
                "purpose": "any",
                "sizes": "512x512",
                "src": "/web-app-icon-512.png",
                "type": "image/png",
            },
            {
                "purpose": "maskable",
                "sizes": "512x512",
                "src": "/web-app-icon-512.png",
                "type": "image/png",
            },
        ],
        "id": "/",
        "name": "G&E Recipes",
        "scope": "/",
        "share_target": {
            "action": f"{base_url}/import",
            "method": "GET",
            "params": {
                "text": "text",
                "title": "title",
                "url": "url",
            },
        },
        "short_name": "G&E Recipes",
        "start_url": "/",
        "theme_color": "#f97316",
    }
