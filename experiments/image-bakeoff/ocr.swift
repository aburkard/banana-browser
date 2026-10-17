// Local OCR for bake-off scoring (macOS Vision, no network).
//   ocr <image>                                  -> JSON {width, height, lines: [{text, confidence, x, y, w, h}]}
//   ocr --render <out.png> <width> <fontSize>    -> draws stdin lines as plain left-aligned text (OCR calibration)
// Language correction is off so model misspellings are not silently repaired.
import AppKit
import Foundation
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

func render(out: String, width: Int, fontSize: CGFloat) {
  let lines = (String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? "")
    .split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
  let lineHeight = fontSize * 1.6
  let height = Int(ceil(CGFloat(lines.count) * lineHeight + fontSize * 4))
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
    let context = NSGraphicsContext(bitmapImageRep: rep) else { fail("Could not create bitmap") }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  NSColor.white.setFill()
  NSRect(x: 0, y: 0, width: width, height: height).fill()
  let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: fontSize), .foregroundColor: NSColor.black]
  for (index, line) in lines.enumerated() {
    let y = CGFloat(height) - fontSize * 2 - CGFloat(index + 1) * lineHeight
    NSAttributedString(string: line, attributes: attributes).draw(at: NSPoint(x: fontSize * 2, y: y))
  }
  NSGraphicsContext.restoreGraphicsState()
  guard let png = rep.representation(using: .png, properties: [:]) else { fail("Could not encode PNG") }
  do { try png.write(to: URL(fileURLWithPath: out)) } catch { fail("Could not write \(out)") }
}

func recognize(path: String) {
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("Could not read image \(path)") }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  request.recognitionLanguages = ["en-US"]
  do { try VNImageRequestHandler(cgImage: image, options: [:]).perform([request]) } catch { fail("OCR failed: \(error)") }
  let width = Double(image.width), height = Double(image.height)
  // Vision boxes are normalized with a bottom-left origin; report top-left pixels.
  let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return ["text": candidate.string, "confidence": Double(candidate.confidence),
      "x": box.minX * width, "y": (1 - box.maxY) * height, "w": box.width * width, "h": box.height * height]
  }
  let output: [String: Any] = ["width": image.width, "height": image.height, "lines": lines]
  guard let json = try? JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]) else { fail("Could not encode JSON") }
  FileHandle.standardOutput.write(json)
}

let args = CommandLine.arguments
if args.count == 5 && args[1] == "--render" {
  guard let width = Int(args[3]), let size = Double(args[4]) else { fail("Usage: ocr --render <out.png> <width> <fontSize>") }
  render(out: args[2], width: width, fontSize: CGFloat(size))
} else if args.count == 2 {
  recognize(path: args[1])
} else {
  fail("Usage: ocr <image> | ocr --render <out.png> <width> <fontSize>")
}
