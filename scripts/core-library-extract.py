"""Audit XLS cells and extract embedded source images without opening a GUI.

Usage: python scripts/core-library-extract.py SOURCE OUTPUT_DIR --xlrd-path PATH
All raw workbook/audit/intermediate files belong in an external update directory.
This script does not infer model equivalence or convert missing values to zero.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import struct
import zlib


def digest(data):
    return hashlib.sha256(data).hexdigest()


def biff_records(data, start=0, end=None):
    end = len(data) if end is None else end
    position = start
    while position + 4 <= end:
        kind, size = struct.unpack_from("<HH", data, position)
        if position + 4 + size > end:
            raise ValueError("Truncated BIFF record at " + str(position))
        yield position, kind, data[position + 4:position + 4 + size]
        position += 4 + size


def escher_records(data):
    """Yield OfficeArt records recursively; store unparsed tails in audit."""
    def walk(begin, end, parent):
        position = begin
        while position + 8 <= end:
            options, kind, size = struct.unpack_from("<HHI", data, position)
            last = position + 8 + size
            if last > end:
                return
            version, instance = options & 15, options >> 4
            body = data[position + 8:last]
            entry = {"offset": position, "kind": kind, "version": version,
                     "instance": instance, "body": body, "parent": parent}
            yield entry
            if version == 15:
                yield from walk(position + 8, last, position)
            position = last
    yield from walk(0, len(data), None)


def drawing_chunks(records, target):
    output = bytearray()
    collecting = False
    for _, kind, body in records:
        if kind == target:
            output.extend(body)
            collecting = True
        elif kind == 0x003C and collecting:
            output.extend(body)
        else:
            collecting = False
    return bytes(output)


def image_bytes(record):
    formats = {0xF01A: ("emf", 0x3D4), 0xF01B: ("wmf", 0x216),
               0xF01C: ("pict", 0x542), 0xF01D: ("jpg", 0x46A),
               0xF01E: ("png", 0x6E0), 0xF01F: ("dib", 0x7A8),
               0xF029: ("tiff", 0x6E4)}
    if record["kind"] not in formats:
        return None
    extension, one_uid_instance = formats[record["kind"]]
    body = record["body"]
    uid_size = 16 if record["instance"] == one_uid_instance else 32
    if extension in ("emf", "wmf", "pict"):
        if len(body) < uid_size + 34:
            return None
        unpacked_size = struct.unpack_from("<I", body, uid_size)[0]
        packed_size = struct.unpack_from("<I", body, uid_size + 28)[0]
        compression = body[uid_size + 32]
        payload = body[uid_size + 34:uid_size + 34 + packed_size]
        if compression == 0:
            try:
                payload = zlib.decompress(payload)
            except zlib.error:
                payload = zlib.decompress(payload, -15)
        elif compression != 0xFE:
            raise ValueError("Unknown OfficeArt metafile compression")
        if len(payload) != unpacked_size:
            raise ValueError("Metafile uncompressed size mismatch")
    else:
        payload = body[uid_size + 1:]
    return extension, payload


def inspect_xls(source, output, xlrd_path):
    if xlrd_path:
        import sys
        sys.path.insert(0, str(xlrd_path))
    import xlrd
    from xlrd.compdoc import CompDoc
    raw = source.read_bytes()
    compound = CompDoc(raw)
    stream = compound.get_named_stream("Workbook") or compound.get_named_stream("Book")
    if not stream:
        raise ValueError("XLS has no Workbook stream")
    book = xlrd.open_workbook(file_contents=raw, formatting_info=True)
    offsets = []
    for _, kind, body in biff_records(stream):
        if kind == 0x0085:
            offsets.append(struct.unpack_from("<I", body)[0])
    drawing_group = drawing_chunks(biff_records(stream, end=min(offsets)), 0x00EB)
    drawing_entries = list(escher_records(drawing_group))
    image_dir = output / "source-images"
    image_dir.mkdir(parents=True, exist_ok=True)
    images = []
    bse_count = 0
    pending_bse = None
    for entry in drawing_entries:
        if entry["kind"] == 0xF007:
            bse_count += 1
            pending_bse = bse_count
            # BSE's embedded BLIP is after a 36-byte header plus optional name.
            body = entry["body"]
            if len(body) >= 36:
                name_size = body[33]
                start = 36 + name_size
                for nested in escher_records(body[start:]):
                    extracted = image_bytes(nested)
                    if extracted:
                        extension, payload = extracted
                        name = digest(payload)[:20] + "." + extension
                        (image_dir / name).write_bytes(payload)
                        images.append({"bseIndex": pending_bse, "file": str(image_dir / name),
                                       "sha256": digest(payload), "bytes": len(payload),
                                       "format": extension, "officeArtType": nested["kind"]})
        elif entry["kind"] in (0xF01A, 0xF01B, 0xF01C, 0xF01D, 0xF01E, 0xF01F, 0xF029):
            extracted = image_bytes(entry)
            if extracted:
                extension, payload = extracted
                name = digest(payload)[:20] + "." + extension
                (image_dir / name).write_bytes(payload)
                images.append({"bseIndex": pending_bse, "file": str(image_dir / name),
                               "sha256": digest(payload), "bytes": len(payload),
                               "format": extension, "officeArtType": entry["kind"]})
    sheets = []
    for index in range(book.nsheets):
        sheet = book.sheet_by_index(index)
        start = offsets[index]
        end = offsets[index + 1] if index + 1 < len(offsets) else len(stream)
        raw_sheet_records = list(biff_records(stream, start, end))
        entries = list(escher_records(drawing_chunks(raw_sheet_records, 0x00EC)))
        anchors = []
        shapes = collections.defaultdict(dict)
        for entry in entries:
            owner = entry["parent"]
            if entry["kind"] == 0xF00A and len(entry["body"]) >= 8:
                shapes[owner]["shapeId"] = struct.unpack_from("<I", entry["body"])[0]
            elif entry["kind"] == 0xF010 and len(entry["body"]) >= 18:
                flag, col1, dx1, row1, dy1, col2, dx2, row2, dy2 = struct.unpack_from("<9H", entry["body"])
                shapes[owner]["anchor"] = {"rowStart": row1 + 1, "rowEnd": row2 + 1,
                                         "columnStart": col1 + 1, "columnEnd": col2 + 1,
                                         "dxStart": dx1, "dyStart": dy1, "dxEnd": dx2,
                                         "dyEnd": dy2, "flag": flag}
            elif entry["kind"] in (0xF00B, 0xF121, 0xF122):
                body = entry["body"]
                for prop in range(entry["instance"]):
                    if prop * 6 + 6 > len(body):
                        break
                    key, value = struct.unpack_from("<HI", body, prop * 6)
                    if (key & 0x3FFF) == 0x0104:
                        shapes[owner]["bseIndex"] = value
        for shape in shapes.values():
            if "anchor" in shape or "bseIndex" in shape:
                anchors.append(shape)
        rows = [{"row": row + 1, "values": sheet.row_values(row)}
                for row in range(sheet.nrows) if any(value != "" for value in sheet.row_values(row))]
        formulas = [{"row": struct.unpack_from("<H", body)[0] + 1,
                     "column": struct.unpack_from("<H", body, 2)[0] + 1}
                    for _, kind, body in raw_sheet_records if kind == 0x0006]
        sheets.append({"name": sheet.name, "rows": sheet.nrows, "columns": sheet.ncols,
                       "mergedCells": sheet.merged_cells, "data": rows,
                       "drawingAnchors": anchors, "formulaCells": formulas,
                       "drawingRecordCount": sum(kind == 0x00EC for _, kind, _ in raw_sheet_records)})
    return {"source": {"filename": source.name, "sha256": digest(raw), "bytes": len(raw),
                       "format": "OLE XLS"}, "sheets": sheets, "images": images,
            "audit": {"sheetCount": book.nsheets, "bseCount": bse_count,
                      "uniqueImageCount": len(set(image["sha256"] for image in images)),
                      "notes": ["OfficeArt previews are source diagrams; model binding requires cell-level review."]}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--xlrd-path", type=pathlib.Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    result = inspect_xls(args.source, args.output, args.xlrd_path)
    (args.output / "workbook-inspection.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["audit"], ensure_ascii=False))