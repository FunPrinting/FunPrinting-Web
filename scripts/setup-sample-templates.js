const mongoose = require('mongoose');

// Define the schema directly in the script
const dynamicTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['lab-manual', 'assignment', 'report', 'certificate', 'other'],
    default: 'other'
  },
  pdfUrl: {
    type: String,
    required: true
  },
  placeholders: [{
    type: String,
    required: true
  }],
  // Technical details
  os: {
    type: String,
    trim: true
  },
  dbms: {
    type: String,
    trim: true
  },
  programmingLanguage: {
    type: String,
    trim: true
  },
  framework: {
    type: String,
    trim: true
  },
  tools: [{
    type: String,
    trim: true
  }],
  // Metadata
  createdBy: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Create the model
const DynamicTemplate = mongoose.model('DynamicTemplate', dynamicTemplateSchema);

// Sample dynamic templates
const sampleTemplates = [
  {
    name: "Computer Science Lab Manual - Data Structures",
    description: "Comprehensive lab manual for Data Structures and Algorithms course. Includes practical implementations of arrays, linked lists, trees, and graphs.",
    category: "lab-manual",
    pdfUrl: "https://example.com/cs-lab-manual.pdf",
    placeholders: ["@name", "@rollno", "@course", "@semester", "@lab", "@experiment", "@date"],
    os: "Windows 10/11, macOS, Linux",
    programmingLanguage: "C++, Java, Python",
    framework: "Visual Studio Code, IntelliJ IDEA",
    tools: ["Git", "GDB", "Valgrind", "JUnit"],
    createdBy: "admin"
  },
  {
    name: "Database Management System Lab",
    description: "Practical database design and SQL implementation lab manual. Covers ER diagrams, normalization, and complex queries.",
    category: "lab-manual",
    pdfUrl: "https://example.com/dbms-lab-manual.pdf",
    placeholders: ["@name", "@rollno", "@instructor", "@course", "@semester", "@lab", "@date"],
    os: "Windows, Linux",
    dbms: "MySQL, PostgreSQL, Oracle",
    programmingLanguage: "SQL, Python",
    framework: "phpMyAdmin, pgAdmin",
    tools: ["MySQL Workbench", "DBeaver", "ERDPlus"],
    createdBy: "admin"
  },
  {
    name: "Web Development Assignment Template",
    description: "Professional template for web development assignments. Includes sections for frontend, backend, and deployment details.",
    category: "assignment",
    pdfUrl: "https://example.com/web-dev-assignment.pdf",
    placeholders: ["@name", "@rollno", "@course", "@semester", "@title", "@description", "@date"],
    os: "Cross-platform",
    programmingLanguage: "HTML, CSS, JavaScript",
    framework: "React, Node.js, Express",
    tools: ["VS Code", "Git", "Chrome DevTools", "Postman"],
    createdBy: "admin"
  },
  {
    name: "Machine Learning Lab Report",
    description: "Structured template for machine learning experiment reports. Includes methodology, results, and analysis sections.",
    category: "report",
    pdfUrl: "https://example.com/ml-lab-report.pdf",
    placeholders: ["@name", "@rollno", "@course", "@semester", "@experiment", "@algorithm", "@date"],
    os: "Linux, macOS",
    programmingLanguage: "Python",
    framework: "TensorFlow, PyTorch, Scikit-learn",
    tools: ["Jupyter Notebook", "Google Colab", "Matplotlib", "Pandas"],
    createdBy: "admin"
  },
  {
    name: "Software Engineering Certificate",
    description: "Professional certificate template for software engineering achievements and project completions.",
    category: "certificate",
    pdfUrl: "https://example.com/software-eng-certificate.pdf",
    placeholders: ["@name", "@course", "@project", "@date", "@instructor"],
    os: "Cross-platform",
    programmingLanguage: "Multiple",
    framework: "Various",
    tools: ["Git", "Docker", "Jenkins", "Jira"],
    createdBy: "admin"
  }
];

async function setupSampleTemplates() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      console.error('❌ MONGODB_URI is not set');
      process.exit(1);
    }
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing templates
    await DynamicTemplate.deleteMany({});
    console.log('Cleared existing templates');

    // Insert sample templates
    const result = await DynamicTemplate.insertMany(sampleTemplates);
    console.log(`Inserted ${result.length} sample templates`);

    // Display the created templates
    console.log('\nCreated templates:');
    result.forEach(template => {
      console.log(`- ${template.name} (${template.category})`);
    });

    console.log('\nSample templates setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error setting up sample templates:', error);
    process.exit(1);
  }
}

setupSampleTemplates();
