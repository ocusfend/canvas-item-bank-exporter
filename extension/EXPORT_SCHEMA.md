# Canvas Item Bank Export Schema v2.1

This document describes the JSON export format produced by the Canvas Item Bank Exporter extension.

## Overview

The export produces a single JSON file containing all items from a Canvas item bank, with complete metadata, scoring data, and type-specific configurations preserved.

---

## Root Object

| Field | Type | Description |
|-------|------|-------------|
| `exportVersion` | string | Schema version (currently `"2.1"`) |
| `exportedAt` | string | ISO 8601 timestamp of export |
| `bank` | object | Bank metadata |
| `summary` | object | Export statistics |
| `items` | array | Array of exported items |
| `skipped` | array | Always empty in v2.1 (kept for backwards compatibility) |

---

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

---

## Summary Object

| Field | Type | Description |
|-------|------|-------------|
| `totalItems` | number | Total items in bank |
| `exportedItems` | number | Items included in export (same as total in v2.1) |
| `skippedItems` | number | Always `0` in v2.1 |

---

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
| `type` | string | Normalized question type code (see Question Types) |
| `originalType` | string | Original Canvas/Learnosity type slug |
| `entryType` | string | Entry type (`"Item"` or `"Stimulus"`) |
| `interactionType` | object\|null | Full interaction type details |

#### InteractionType Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string\|null | Interaction type ID |
| `slug` | string | Type slug identifier |
| `name` | string\|null | Human-readable name |
| `propertiesSchema` | object\|null | JSON schema for properties |
| `scoringAlgorithmOptions` | array | Available scoring algorithms |
| `scoringAlgorithmDefault` | string\|null | Default scoring algorithm |
| `userResponseTypeOptions` | array | Response type options |

### Status & Metadata

| Field | Type | Description |
|-------|------|-------------|
| `status` | string\|null | Item status |
| `archived` | boolean | Whether item is archived |
| `label` | string\|null | Item label |
| `createdAt` | string\|null | ISO 8601 creation timestamp |
| `updatedAt` | string\|null | ISO 8601 last update timestamp |

### Content

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Question title/name |
| `body` | string | Question body (HTML) |
| `points` | number | Points possible |

### Relationships

| Field | Type | Description |
|-------|------|-------------|
| `stimulusId` | string\|null | Associated stimulus/passage ID |
| `outcomeAlignment` | string\|null | Outcome alignment GUID |

### Metadata & Tags

| Field | Type | Description |
|-------|------|-------------|
| `metadata.tags` | array | Array of tag strings |
| `metadata.tagAssociations` | array | Tag association objects |

### Answers

| Field | Type | Description |
|-------|------|-------------|
| `answers` | array | Answer objects (format varies by type) |

### Scoring Configuration

| Field | Type | Description |
|-------|------|-------------|
| `scoring.algorithm` | string\|null | Scoring algorithm used |
| `scoring.userResponseType` | string\|null | User response type |
| `scoring.calculatorType` | string | Calculator type (`"none"`, `"basic"`, `"scientific"`) |
| `scoring.marginOfError` | number\|null | Margin of error for numeric |
| `scoring.marginType` | string\|null | Margin type (`"absolute"` or `"percent"`) |

### Properties

| Field | Type | Description |
|-------|------|-------------|
| `properties.varyPointsByAnswer` | boolean | Points vary by answer |
| `properties.shuffleRules` | object\|null | Shuffle configuration |
| `properties.spellCheck` | boolean\|null | Spell check enabled |
| `properties.showWordCount` | boolean\|null | Show word count |
| `properties.wordLimit` | boolean\|null | Word limit enabled |
| `properties.wordLimitMin` | number\|null | Minimum word count |
| `properties.wordLimitMax` | number\|null | Maximum word count |

### Feedback

| Field | Type | Description |
|-------|------|-------------|
| `feedback.correct` | string | Feedback for correct answers |
| `feedback.incorrect` | string | Feedback for incorrect answers |
| `feedback.neutral` | string | Neutral feedback |
| `answerFeedback` | object | Per-answer feedback keyed by answer ID |

### Raw Data Preservation

| Field | Type | Description |
|-------|------|-------------|
| `rawInteractionData` | object\|null | Complete original interaction_data |
| `rawScoringData` | object\|null | Complete original scoring_data |
| `allowedFiles` | array\|null | Allowed file types for upload questions |

---

## Question Types

### Type Codes

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

## Type-Specific Answer Formats

### Multiple Choice (MC) / Multiple Response (MR)

```json
{
  "answers": [
    {
      "id": "choice_uuid",
      "text": "Answer text (HTML stripped)",
      "correct": true
    }
  ]
}
```

### True/False (TF)

```json
{
  "answers": [
    { "id": "true", "text": "True", "correct": true },
    { "id": "false", "text": "False", "correct": false }
  ]
}
```

### Short Answer (SA)

```json
{
  "answers": [
    { "id": "answer_0", "text": "acceptable answer", "correct": true },
    { "id": "answer_1", "text": "another acceptable answer", "correct": true }
  ]
}
```

### Numeric (NUM)

```json
{
  "answers": [
    {
      "id": "numeric_0",
      "text": "42",
      "correct": true,
      "type": "exactResponse"
    }
  ],
  "numericSettings": {
    "answers": [
      {
        "id": "answer_uuid",
        "type": "exactResponse",
        "value": 42,
        "margin": 0.5,
        "marginType": "absolute"
      }
    ]
  }
}
```

### Matching (MAT)

```json
{
  "answers": [
    {
      "id": "question_uuid",
      "questionText": "Left side text",
      "answerText": "Right side match",
      "correct": true
    }
  ],
  "matchingSettings": {
    "questions": [
      { "id": "q_uuid", "text": "Question text", "answerText": "Answer text" }
    ],
    "shuffleQuestions": false
  }
}
```

### Categorization (CAT)

```json
{
  "answers": [
    {
      "id": "category_uuid",
      "categoryText": "Category name",
      "answers": ["Item 1", "Item 2"],
      "correct": true
    }
  ],
  "categorizationSettings": {
    "categories": [
      { "id": "cat_uuid", "text": "Category name" }
    ],
    "choices": [
      { "id": "choice_uuid", "text": "Item text" }
    ],
    "scoreMethod": "allOrNothing"
  }
}
```

### Ordering (ORD)

```json
{
  "answers": [
    {
      "id": "item_uuid",
      "text": "First item",
      "position": 1,
      "correct": true
    },
    {
      "id": "item_uuid",
      "text": "Second item",
      "position": 2,
      "correct": true
    }
  ],
  "orderingSettings": {
    "topLabel": "First",
    "bottomLabel": "Last",
    "choices": [
      { "id": "choice_uuid", "text": "Item text", "position": 1 }
    ]
  }
}
```

### Hot Spot (HS)

```json
{
  "answers": [
    {
      "id": "hotspot_uuid",
      "type": "circle",
      "coordinates": { "x": 100, "y": 150, "radius": 50 },
      "correct": true
    }
  ],
  "hotSpotSettings": {
    "imageUrl": "https://...",
    "hotspotsCount": 2
  }
}
```

### Formula (FORM)

```json
{
  "answers": [
    {
      "id": "solution_0",
      "inputs": { "x": 5, "y": 3 },
      "output": "15",
      "correct": true
    }
  ],
  "formulaSettings": {
    "variables": [
      { "name": "x", "min": 1, "max": 10, "precision": 0 }
    ],
    "answerCount": 5,
    "formula": "x * y"
  }
}
```

### Essay (ESS)

```json
{
  "answers": [],
  "essaySettings": {
    "spellCheck": true,
    "showWordCount": true,
    "wordLimit": true,
    "wordLimitMin": 100,
    "wordLimitMax": 500
  }
}
```

### Passage (PASSAGE) / File Upload (FU)

```json
{
  "answers": [],
  "allowedFiles": ["pdf", "docx", "jpg"]
}
```

---

## Example Export

```json
{
  "exportVersion": "2.1",
  "exportedAt": "2024-01-15T10:30:00.000Z",
  "bank": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Chapter 5 Quiz Questions",
    "description": "Assessment items for Chapter 5",
    "status": "active",
    "archived": false,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-15T10:00:00.000Z",
    "contextId": "12345",
    "contextType": "Course",
    "contextUuid": "course-uuid",
    "workflowState": "active",
    "alignmentData": null,
    "metadata": {}
  },
  "summary": {
    "totalItems": 25,
    "exportedItems": 25,
    "skippedItems": 0
  },
  "items": [
    {
      "id": "item-uuid-1",
      "bankId": "bank-uuid",
      "bankEntryId": "entry-uuid",
      "type": "MC",
      "originalType": "choice",
      "entryType": "Item",
      "interactionType": {
        "id": "1",
        "slug": "choice",
        "name": "Multiple Choice",
        "propertiesSchema": {},
        "scoringAlgorithmOptions": ["allOrNothing"],
        "scoringAlgorithmDefault": "allOrNothing",
        "userResponseTypeOptions": ["choice"]
      },
      "status": "active",
      "archived": false,
      "label": null,
      "createdAt": "2024-01-02T00:00:00.000Z",
      "updatedAt": "2024-01-10T00:00:00.000Z",
      "title": "Sample Question",
      "body": "<p>What is 2 + 2?</p>",
      "points": 1,
      "stimulusId": null,
      "outcomeAlignment": null,
      "metadata": {
        "tags": ["math", "addition"],
        "tagAssociations": []
      },
      "answers": [
        { "id": "a1", "text": "3", "correct": false },
        { "id": "a2", "text": "4", "correct": true },
        { "id": "a3", "text": "5", "correct": false }
      ],
      "scoring": {
        "algorithm": "allOrNothing",
        "userResponseType": "choice",
        "calculatorType": "none",
        "marginOfError": null,
        "marginType": null
      },
      "properties": {
        "varyPointsByAnswer": false,
        "shuffleRules": { "choices": { "shuffled": true } },
        "spellCheck": null,
        "showWordCount": null,
        "wordLimit": null,
        "wordLimitMin": null,
        "wordLimitMax": null
      },
      "feedback": {
        "correct": "Great job!",
        "incorrect": "Try again.",
        "neutral": ""
      },
      "answerFeedback": {},
      "essaySettings": null,
      "numericSettings": null,
      "matchingSettings": null,
      "categorizationSettings": null,
      "orderingSettings": null,
      "hotSpotSettings": null,
      "formulaSettings": null,
      "allowedFiles": null,
      "rawInteractionData": { "choices": [...] },
      "rawScoringData": { "value": "a2" }
    }
  ],
  "skipped": []
}
```

---

## Version History

| Version | Changes |
|---------|---------|
| 2.1 | All question types exported (no filtering), added type mappings for MAT, CAT, ORD, HS, FORM, DD, DRAW, HL, CLOZE |
| 2.0 | Added comprehensive metadata, raw data preservation, type-specific settings |
| 1.0 | Initial export format with basic question types |
