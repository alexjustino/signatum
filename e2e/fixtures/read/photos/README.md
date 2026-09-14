# Photographs for the Read suite

Real photographs and screenshots of printed codes, taken with a phone, go here. The end-to-end
suite reads every image in this folder through the product's own `read_image` command and
compares what it decodes with the payload named beside it.

Add one line per image to `expected.csv` in this folder:

```
file,payload
menu-on-paper.jpg,https://example.com/menu
```

The `payload` column is the exact text the code carries. A file listed here that is missing, or
an image here that is not listed, fails the suite by name. While this folder holds no images the
suite says so — "no photographs in the corpus" — and skips that one test visibly rather than
passing on nothing.

Keep the photographs free of anything that should not be public: this repository is public and
the images are committed with it, for good. That includes what the camera wrote **inside** the
file: a phone photograph carries EXIF — the position it was taken at to a few metres, the
make, model and serial of the phone, the date and time. Strip it before committing (on
Windows: Properties → Details → Remove Properties and Personal Information; or export the
image again from an editor that drops metadata). The suite refuses a photograph that still
carries EXIF, by name, so that it cannot be committed by accident.
