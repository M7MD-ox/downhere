"""DownMe Extractor Registry & Factory."""

from typing import Optional

from server.extractors.base import BaseExtractor
from server.extractors.facebook import FacebookExtractor
from server.extractors.pinterest import PinterestExtractor
from server.extractors.tiktok import TikTokExtractor
from server.extractors.universal import UniversalExtractor
from server.extractors.youtube import YouTubeExtractor

EXTRACTORS: list[BaseExtractor] = [
    YouTubeExtractor(),
    FacebookExtractor(),
    TikTokExtractor(),
    PinterestExtractor(),
    UniversalExtractor(),
]


def get_extractor(url: str) -> BaseExtractor:
    """Find the appropriate extractor for the given media URL."""
    clean_url = url.strip()
    for extractor in EXTRACTORS:
        if extractor.can_handle(clean_url):
            return extractor
    raise ValueError(f"No extractor available for URL: {url}")
