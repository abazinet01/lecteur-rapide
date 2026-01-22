#!/usr/bin/env python3
"""
Generate simple PNG icons for Speed Reader PWA
Uses only standard library (no Pillow required)
"""

import struct
import zlib
import os

def create_png(width, height, pixels):
    """Create a PNG file from pixel data"""
    def chunk(chunk_type, data):
        chunk_len = struct.pack('>I', len(data))
        chunk_crc = struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)
        return chunk_len + chunk_type + data + chunk_crc

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = chunk(b'IHDR', ihdr_data)

    # IDAT chunk (image data)
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # Filter type: None
        for x in range(width):
            raw_data += bytes(pixels[y * width + x])

    compressed = zlib.compress(raw_data, 9)
    idat = chunk(b'IDAT', compressed)

    # IEND chunk
    iend = chunk(b'IEND', b'')

    return signature + ihdr + idat + iend

def create_icon(size):
    """Create a simple speed reader icon"""
    pixels = []

    # Colors
    bg_color = (0, 0, 0)
    inner_bg = (26, 26, 26)
    red = (255, 59, 48)
    white = (255, 255, 255)

    scale = size / 192.0
    padding = int(20 * scale)
    corner_radius = int(30 * scale)

    for y in range(size):
        for x in range(size):
            # Default: black background
            color = bg_color

            # Inner rounded rectangle area
            inner_left = padding
            inner_right = size - padding
            inner_top = padding
            inner_bottom = size - padding

            # Check if inside inner area (simplified - no real corner rounding)
            in_inner = (inner_left <= x < inner_right and
                       inner_top <= y < inner_bottom)

            # Simple corner check (remove corners)
            if in_inner:
                # Check corners
                corners = [
                    (inner_left + corner_radius, inner_top + corner_radius),
                    (inner_right - corner_radius, inner_top + corner_radius),
                    (inner_left + corner_radius, inner_bottom - corner_radius),
                    (inner_right - corner_radius, inner_bottom - corner_radius),
                ]

                in_corner = False
                for cx, cy in corners:
                    dx = x - cx
                    dy = y - cy

                    # Check if in corner region but outside the rounded curve
                    if ((x < inner_left + corner_radius or x >= inner_right - corner_radius) and
                        (y < inner_top + corner_radius or y >= inner_bottom - corner_radius)):
                        dist_sq = dx * dx + dy * dy
                        if dist_sq > corner_radius * corner_radius:
                            in_corner = True
                            break

                if not in_corner:
                    color = inner_bg

            # Draw letters S and R
            center_y = size // 2
            letter_size = int(50 * scale)

            # S position (left of center)
            s_center_x = int(size * 0.35)
            # R position (right of center)
            r_center_x = int(size * 0.65)

            # Very simplified letter rendering (just blocks for now)
            letter_half = int(25 * scale)

            # S letter (red block)
            if (abs(x - s_center_x) < letter_half and
                abs(y - center_y) < letter_half):
                color = red

            # R letter (white block)
            if (abs(x - r_center_x) < letter_half and
                abs(y - center_y) < letter_half):
                color = white

            # ORP line at bottom center
            line_x = size // 2
            line_top = int(size * 0.7)
            line_bottom = int(size * 0.8)
            line_width = int(2 * scale)

            if (abs(x - line_x) <= line_width and
                line_top <= y <= line_bottom):
                color = red

            pixels.append(color)

    return pixels

def main():
    # Create icons directory if needed
    icons_dir = os.path.join(os.path.dirname(__file__), 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    # Generate 192x192 icon
    print("Creating 192x192 icon...")
    pixels_192 = create_icon(192)
    png_192 = create_png(192, 192, pixels_192)
    with open(os.path.join(icons_dir, 'icon-192.png'), 'wb') as f:
        f.write(png_192)
    print("  -> icons/icon-192.png created")

    # Generate 512x512 icon
    print("Creating 512x512 icon...")
    pixels_512 = create_icon(512)
    png_512 = create_png(512, 512, pixels_512)
    with open(os.path.join(icons_dir, 'icon-512.png'), 'wb') as f:
        f.write(png_512)
    print("  -> icons/icon-512.png created")

    print("Done! Icons created successfully.")

if __name__ == '__main__':
    main()
