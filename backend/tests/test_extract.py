from app.extract import extract_page_image_url


def test_extract_page_image_url_prefers_og_image():
    html = """
    <html>
      <head>
        <meta property="og:image" content="https://example.com/hero.jpg" />
        <meta name="twitter:image" content="https://example.com/twitter.jpg" />
      </head>
      <body><img src="https://example.com/body.jpg" /></body>
    </html>
    """
    assert (
        extract_page_image_url(html, "https://example.com/recipe") == "https://example.com/hero.jpg"
    )


def test_extract_page_image_url_uses_recipe_json_ld_image():
    html = """
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Recipe",
          "name": "Chili",
          "image": ["https://example.com/chili-1.jpg", "https://example.com/chili-2.jpg"]
        }
        </script>
      </head>
    </html>
    """
    assert (
        extract_page_image_url(html, "https://example.com/chili")
        == "https://example.com/chili-1.jpg"
    )


def test_extract_page_image_url_falls_back_to_article_image():
    html = """
    <html>
      <body>
        <header><img src="https://example.com/logo.png" width="40" height="40" /></header>
        <article>
          <img src="https://example.com/recipe-photo.jpg" width="1200" height="800" />
        </article>
      </body>
    </html>
    """
    assert (
        extract_page_image_url(html, "https://example.com/recipe")
        == "https://example.com/recipe-photo.jpg"
    )


def test_extract_page_image_url_resolves_relative_urls():
    html = '<meta property="og:image" content="/images/dish.jpg" />'
    assert (
        extract_page_image_url(html, "https://example.com/recipes/dish")
        == "https://example.com/images/dish.jpg"
    )
