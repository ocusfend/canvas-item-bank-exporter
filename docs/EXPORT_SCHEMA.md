# Canvas Quiz Bank Export Schema

This document describes the JSON export formats produced by the Canvas Quiz Bank Exporter extension.

## Overview

The extension supports two export formats:
1. **New Quizzes Item Banks** (`format: "item_bank"`) - v2.2
2. **Classic Quiz Question Banks** (`format: "classic"`) - v1.0

---

## Format Detection

All exports include a `format` field at the root level:

| Format Value | Export Type | Schema Version |
|--------------|-------------|----------------|
| `"item_bank"` | New Quizzes Item Bank | 2.2 |
| `"classic"` | Classic Quiz Question Bank | 1.0 |

### Import Detection Logic

```typescript
function detectExportFormat(data: any): 'classic' | 'item_bank' | 'unknown' {
  // Primary: Explicit format field
  if (data.format === 'classic') return 'classic';
  if (data.format === 'item_bank') return 'item_bank';
  
  // Fallback: Structural detection
  if (data.questions && data.bank?.courseId !== undefined) return 'classic';
  if (data.items && data.bank?.contextUuid) return 'item_bank';
  
  return 'unknown';
}
```

---

# New Quizzes Item Bank Export Schema (v2.2)

## Root Object

| Field | Type | Description |
|-------|------|-------------|
| `format` | `"item_bank"` | Format discriminator |
| `exportVersion` | string | Schema version (`"2.2"`) |
| `extensionVersion` | string | Extension version that created export |
| `exportedAt` | string | ISO 8601 timestamp of export |
| `bank` | object | Bank metadata |
| `summary` | object | Export statistics |
| `items` | array | Array of exported items |
| `skipped` | array | Always empty (backwards compatibility) |

## Bank Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique bank identifier (UUID) |
| `title` | string | Bank title/name |
| `description` | string\|null | Bank description |
| `status` | string\|null | Bank status |
| `archived` | boolean | Whether bank is archived |
| `createdAt` | string\|null | ISO 8601 creation timestamp |
| `updatedAt` | string\|null | ISO 8601 last update timestamp |
| `contextId` | string\|null | Context identifier |
| `contextType` | string\|null | Context type (e.g., "Course") |
| `contextUuid` | string\|null | Context UUID |
| `workflowState` | string\|null | Workflow state |
| `alignmentData` | object\|null | Outcome alignment data |
| `metadata` | object\|null | Additional bank metadata |

## Item Object

### Identity Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique item identifier (UUID) |
| `bankId` | string\|null | Parent bank ID |
| `bankEntryId` | string\|null | Bank entry ID |

### Type Information

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Normalized question type code |
| `originalType` | string | Original Canvas/Learnosity type slug |
| `entryType` | string | Entry type (`"Item"` or `"Stimulus"`) |
| `interactionType` | object\|null | Full interaction type details |

### Content

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Question title/name |
| `body` | string | Question body (HTML) |
| `points` | number | Points possible |

### Answers

| Field | Type | Description |
|-------|------|-------------|
| `answers` | array | Answer objects (format varies by type) |

---

# Classic Quiz Question Bank Export Schema (v1.0)

## Root Object

| Field | Type | Description |
|-------|------|-------------|
| `format` | `"classic"` | Format discriminator |
| `exportVersion` | `"1.0"` | Schema version |
| `extensionVersion` | string | Extension version that created export |
| `exportedAt` | string | ISO 8601 timestamp |
| `canvasSignature` | object | DOM version detection info |
| `typeMap` | object | Classic type mapping used |
| `bank` | object | Bank metadata |
| `summary` | object | Statistics |
| `warnings` | array\|null | Parsing warnings |
| `groups` | array\|null | Question groups for random selection |
| `questions` | array | All questions |

## Canvas Signature Object

| Field | Type | Description |
|-------|------|-------------|
| `domVersion` | string | Detected DOM version (`"2020+"`, `"2022+"`, `"unknown"`) |
| `indicators` | object | Detection indicators |
| `extractedAt` | string | ISO 8601 timestamp |

## Bank Object (Classic)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Bank ID (numeric) |
| `courseId` | string\|null | Course ID (null for shared banks) |
| `title` | string | Bank title |
| `type` | `"assessment_question_bank"` | Bank type |

## Summary Object

| Field | Type | Description |
|-------|------|-------------|
| `totalQuestions` | number | Total questions in bank |
| `questionTypes` | object | Count by type code |

## Groups Object (Optional)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Group identifier |
| `title` | string | Group title |
| `pickCount` | number | Number of questions to pick |
| `questionIds` | array | Question IDs in group |

## Question Object (Classic)

### Identity Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Canvas question ID |
| `uuid` | string | Globally unique identifier |
| `assessmentId` | string | Assessment question ID |

### Type Information

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Normalized type code (see table below) |
| `originalType` | string | Original Canvas type slug |

### Content

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Question title/name |
| `body` | string | Question body (cleaned HTML) |
| `bodyRaw` | string | Original HTML (lossless) |
| `bodyText` | string\|null | Plain text version |
| `points` | number | Points possible |

### Type-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| `blanks` | array\|null | Blank IDs for FIMB/MDD |
| `calculatedData` | object\|null | Formula data for CALC |
| `isInformational` | boolean\|undefined | True for text-only questions |

### Answers

| Field | Type | Description |
|-------|------|-------------|
| `answers` | array\|object | Answer data (format varies by type) |

### Feedback

| Field | Type | Description |
|-------|------|-------------|
| `feedback` | object\|null | Normalized feedback structure |

### Metadata

| Field | Type | Description |
|-------|------|-------------|
| `migratableToNewQuizzes` | boolean | Can migrate to New Quizzes |
| `hash` | string | SHA-256 integrity hash |

---

## Classic Question Types

| Code | Canvas Type | Description |
|------|-------------|-------------|
| `MC` | multiple_choice_question | Multiple Choice |
| `TF` | true_false_question | True/False |
| `MR` | multiple_answers_question | Multiple Response |
| `SA` | short_answer_question | Short Answer |
| `FIMB` | fill_in_multiple_blanks_question | Fill in Multiple Blanks |
| `MDD` | multiple_dropdowns_question | Multiple Dropdowns |
| `MAT` | matching_question | Matching |
| `NUM` | numerical_question | Numerical |
| `CALC` | calculated_question | Calculated/Formula |
| `ESS` | essay_question | Essay |
| `FU` | file_upload_question | File Upload |
| `TB` | text_only_question | Text Block (informational) |

---

## Classic Answer Formats

### Standard Answers (MC, TF, MR, SA, FIMB, MDD)

```json
{
  "answers": [
    {
      "id": "answer_id",
      "text": "Answer text",
      "html": "<p>Answer HTML</p>",
      "correct": true,
      "weight": 100,
      "blankId": "blank_1",
      "feedback": {
        "html": "<p>Feedback</p>",
        "text": "Feedback"
      }
    }
  ]
}
```

### Matching Pairs

```json
{
  "answers": {
    "type": "matching",
    "pairs": [
      {
        "id": "pair_id",
        "left": "Left side text",
        "right": "Right side match",
        "matchId": "match_id"
      }
    ],
    "distractors": [
      {
        "id": "distractor_id",
        "text": "Distractor text"
      }
    ]
  }
}
```

### Numerical Answers

```json
{
  "answers": [
    {
      "id": "answer_id",
      "numericalType": "exact",
      "exact": 42,
      "margin": 0,
      "rangeStart": null,
      "rangeEnd": null,
      "precision": null,
      "precisionScale": null,
      "correct": true,
      "weight": 100
    }
  ]
}
```

#### Numerical Type Values

| Value | Description |
|-------|-------------|
| `exact` | Exact value match |
| `exact_with_margin` | Exact value with ± margin of error |
| `range` | Value within range (min-max) |
| `approximate` | Approximate with precision |

### Calculated Question Data

```json
{
  "calculatedData": {
    "variables": [
      { "name": "x", "min": 1, "max": 10, "decimalPlaces": 0 }
    ],
    "formulas": ["x * 2"],
    "tolerance": 0.01,
    "answerDecimalPlaces": 2,
    "solutions": [
      { "x": 5, "_answer": 10 }
    ]
  }
}
```

---

## Feedback Structure (Classic)

```json
{
  "feedback": {
    "correct": { "html": "<p>Great!</p>", "text": "Great!" },
    "incorrect": { "html": "<p>Try again</p>", "text": "Try again" },
    "neutral": { "html": null, "text": null }
  }
}
```

---

## New Quizzes Question Types

| Code | Full Name | Canvas Slugs |
|------|-----------|--------------|
| `MC` | Multiple Choice | `choice`, `multiple_choice_question` |
| `MR` | Multiple Response | `multi-answer`, `multiple_answers_question` |
| `TF` | True/False | `true-false`, `true_false_question` |
| `SA` | Short Answer | `fill-blank`, `rich-fill-blank`, `short_answer_question` |
| `ESS` | Essay | `essay`, `essay_question` |
| `NUM` | Numeric | `numeric`, `numerical_question` |
| `FU` | File Upload | `file-upload`, `file_upload_question` |
| `MAT` | Matching | `matching`, `match`, `matching_question` |
| `CAT` | Categorization | `categorization`, `categorize`, `categorization_question` |
| `ORD` | Ordering | `ordering`, `order`, `ordering_question` |
| `HS` | Hot Spot | `hot-spot`, `hotspot`, `hot_spot_question` |
| `FORM` | Formula | `formula`, `calculated_question`, `formula_question` |
| `PASSAGE` | Passage/Text Block | `text-block`, `text_block`, `passage` |
| `STIMULUS` | Stimulus | `stimulus` |
| `ECR` | Explicit Constructed Response | `explicit-constructed-response` |
| `DD` | Drag and Drop | `drag-drop` |
| `DRAW` | Draw | `draw` |
| `HL` | Highlight | `highlight` |
| `CLOZE` | Cloze | `cloze` |

---

## Example Exports

### Classic Quiz Export

```json
{
  "format": "classic",
  "exportVersion": "1.0",
  "extensionVersion": "0.6.0",
  "exportedAt": "2024-01-15T10:30:00.000Z",
  "canvasSignature": {
    "domVersion": "2022+",
    "indicators": { "hasCsrfToken": true, "hasInstui": true },
    "extractedAt": "2024-01-15T10:30:00.000Z"
  },
  "typeMap": { "multiple_choice_question": "MC", "true_false_question": "TF" },
  "bank": {
    "id": "12345",
    "courseId": "67890",
    "title": "Chapter 5 Questions",
    "type": "assessment_question_bank"
  },
  "summary": {
    "totalQuestions": 10,
    "questionTypes": { "MC": 6, "TF": 4 }
  },
  "warnings": null,
  "groups": null,
  "questions": [
    {
      "id": "123",
      "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "assessmentId": "123",
      "type": "MC",
      "originalType": "multiple_choice_question",
      "title": "Sample Question",
      "body": "<p>What is 2 + 2?</p>",
      "bodyRaw": "<p>What is 2 + 2?</p>",
      "bodyText": "What is 2 + 2?",
      "points": 1,
      "answers": [
        { "id": "a1", "text": "3", "correct": false, "weight": 0 },
        { "id": "a2", "text": "4", "correct": true, "weight": 100 }
      ],
      "feedback": {
        "correct": { "html": "<p>Correct!</p>", "text": "Correct!" },
        "incorrect": { "html": "<p>Try again</p>", "text": "Try again" },
        "neutral": null
      },
      "migratableToNewQuizzes": true,
      "hash": "abc123..."
    }
  ]
}
```

### New Quizzes Export

```json
{
  "format": "item_bank",
  "exportVersion": "2.2",
  "extensionVersion": "0.6.0",
  "exportedAt": "2024-01-15T10:30:00.000Z",
  "bank": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Chapter 5 Quiz Questions",
    "description": "Assessment items for Chapter 5",
    "status": "active",
    "archived": false,
    "contextId": "12345",
    "contextType": "Course",
    "contextUuid": "course-uuid"
  },
  "summary": {
    "totalItems": 25,
    "exportedItems": 25,
    "skippedItems": 0
  },
  "items": [
    {
      "id": "item-uuid-1",
      "type": "MC",
      "originalType": "choice",
      "title": "Sample Question",
      "body": "<p>What is 2 + 2?</p>",
      "points": 1,
      "answers": [
        { "id": "a1", "text": "3", "correct": false },
        { "id": "a2", "text": "4", "correct": true }
      ]
    }
  ],
  "skipped": []
}
```
