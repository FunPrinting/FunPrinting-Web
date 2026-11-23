const { MongoClient } = require("mongodb");
const crypto = require("crypto");
require("dotenv").config();

// List of all recoverable templates identified before November 12, 2025
const recoverableTemplates = [
  {
    name: "Computer Science Syllabus (with DSA & Programming)",
    description: "Course Syllabus template covering Programming, Data Structures, Algorithms, and Software Engineering",
    category: "academic",
    pdfUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1756814187/templates/document_1756814183595",
    wordUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1756814188/templates/document_1756814187757",
    placeholders: [
      "academicYear",
      "studentName",
      "rollNumber",
      "courseName",
      "instructorName",
      "date",
      "className",
      "section"
    ],
    formSchema: [
      { name: "studentName", label: "Student Name", type: "text", required: true },
      { name: "rollNumber", label: "Roll Number", type: "text", required: true },
      { name: "academicYear", label: "Academic Year", type: "text", defaultValue: "2024-2025" },
      { name: "courseName", label: "Course Name", type: "text", defaultValue: "Data Structures & Algorithms" },
      { name: "instructorName", label: "Instructor Name", type: "text" },
      { name: "date", label: "Date", type: "date" }
    ],
    isPublic: true
  },
  {
    name: "Java Programming Laboratory (PBC-501)",
    description: "Practical File for Java Programming Laboratory (PBC-501) BCA 5th Sem",
    category: "lab-manual",
    pdfUrl: "",
    wordUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1757945313/raw-templates/document_1757945313096_us7t9rtq7",
    placeholders: ["Name", "Roll", "sec", "Teacher"],
    formSchema: [
      { name: "Name", label: "Student Name", type: "text", required: true },
      { name: "Roll", label: "Roll Number", type: "text", required: true },
      { name: "sec", label: "Section", type: "text", required: true },
      { name: "Teacher", label: "Teacher / Faculty Name", type: "text", required: true }
    ],
    isPublic: true
  },
  {
    name: "Operating Systems Lab (PCS-502) - Pre-Nov 12",
    description: "Term work of Operating System Lab (PCS-502) B.Tech Vth Semester (Faculty: Mr. Vishal Singh Jalal)",
    category: "lab-manual",
    pdfUrl: "",
    wordUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1762856493/raw-templates/document_1762856493455_bms8x50pa",
    placeholders: ["Name", "RollNo"],
    formSchema: [
      { name: "Name", label: "Student Name", type: "text", required: true },
      { name: "RollNo", label: "Roll Number", type: "text", required: true }
    ],
    isPublic: true
  },
  {
    name: "Operating Systems Lab (PCS-502) - September Version",
    description: "Term work of Operating Systems Lab (PCS 502) Vth Sem B.Tech",
    category: "lab-manual",
    pdfUrl: "",
    wordUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1757589869/raw-templates/document_1757589869125_jkmbxiwze",
    placeholders: ["NAME", "ROLL", "Teacher"],
    formSchema: [
      { name: "NAME", label: "Student Name", type: "text", required: true },
      { name: "ROLL", label: "Roll Number", type: "text", required: true },
      { name: "Teacher", label: "Teacher Name", type: "text", required: true }
    ],
    isPublic: true
  },
  {
    name: "DBMS Lab (PCS-503) - Original",
    description: "Term work of DBMS LAB (PCS-503) B.Tech 6th / 5th Sem",
    category: "lab-manual",
    pdfUrl: "",
    wordUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1757512796/raw-templates/document_1757512792019_ov1e1ppc9",
    placeholders: ["Name", "Roll", "Teacher"],
    formSchema: [
      { name: "Name", label: "Student Name", type: "text", required: true },
      { name: "Roll", label: "Roll Number", type: "text", required: true },
      { name: "Teacher", label: "Teacher Name", type: "text", required: true }
    ],
    isPublic: true
  },
  {
    name: "Computer Networks Lab (PCS-604) - Original",
    description: "Term work of Computer Networks Lab (PCS-604) VI Semester B.Tech",
    category: "lab-manual",
    pdfUrl: "",
    wordUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1757503651/raw-templates/document_1757503643923_ir0xrtm1o",
    placeholders: ["Name", "Roll", "Teacher"],
    formSchema: [
      { name: "Name", label: "Student Name", type: "text", required: true },
      { name: "Roll", label: "Roll Number", type: "text", required: true },
      { name: "Teacher", label: "Teacher Name", type: "text", required: true }
    ],
    isPublic: true
  },
  {
    name: "Student Report Card Management Synopsis",
    description: "Synopsis template for Student Report Card Management System (GEHU Bhimtal)",
    category: "project-report",
    pdfUrl: "",
    wordUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1757066965/templates/document_1757066961991",
    placeholders: ["Name", "app", "towerId"],
    formSchema: [
      { name: "Name", label: "Student / Team Name", type: "text", required: true },
      { name: "app", label: "Project Title", type: "text", defaultValue: "Student Report Card Management" }
    ],
    isPublic: true
  },
  {
    name: "CS Semester V Course Specification & Syllabus",
    description: "Graphic Era Hill University B.Tech CS Sem V Course specification and syllabus format",
    category: "academic",
    pdfUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1756741205/templates/document_1756741199918",
    wordUrl: "https://res.cloudinary.com/da8lufst0/raw/upload/v1756741207/templates/document_1756741206275",
    placeholders: [
      "subject_code",
      "course_title",
      "lecture_hours",
      "tutorial_hours",
      "practical_hours",
      "student_name",
      "roll_number"
    ],
    formSchema: [
      { name: "subject_code", label: "Subject Code", type: "text", required: true },
      { name: "course_title", label: "Course Title", type: "text", required: true },
      { name: "student_name", label: "Student Name", type: "text" },
      { name: "roll_number", label: "Roll Number", type: "text" }
    ],
    isPublic: true
  }
];

async function restore() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();
    const col = db.collection("dynamictemplates");

    console.log(`Starting recovery of ${recoverableTemplates.length} templates...`);

    for (const t of recoverableTemplates) {
      const exists = await col.findOne({ name: t.name });
      if (exists) {
        console.log(`- Template "${t.name}" already exists in DB. Skipping.`);
        continue;
      }

      const doc = {
        id: crypto.randomUUID(),
        name: t.name,
        description: t.description,
        category: t.category,
        pdfUrl: t.pdfUrl || "",
        wordUrl: t.wordUrl,
        wordContent: { paragraphs: [], tables: [] },
        placeholders: t.placeholders,
        formSchema: t.formSchema,
        tools: [],
        createdBy: "adityapandey.dev.in@gmail.com",
        createdByName: "Aditya Pandey",
        createdByEmail: "adityapandey.dev.in@gmail.com",
        createdByType: "admin",
        isPublic: t.isPublic,
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0
      };

      await col.insertOne(doc);
      console.log(`✅ Restored template: "${t.name}" (ID: ${doc.id})`);
    }

    console.log("\nFinished restoring templates.");
  } catch (err) {
    console.error("Error during restoration:", err);
  } finally {
    await client.close();
  }
}

if (process.argv.includes("--run")) {
  restore();
} else {
  console.log("Dry run. Pass --run to insert these templates into MongoDB.");
  console.log(JSON.stringify(recoverableTemplates, null, 2));
}

