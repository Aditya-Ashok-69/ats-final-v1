"""
Standalone script to verify the updated prompt behavior against the
real Groq API. Run this after setting GROQ_API_KEY in your .env.

Usage:
    python test_prompt_behavior.py

This tests three things that can't be verified without a live model call:
  1. Internships are correctly separated into "internships", not "work_experience"
  2. is_technical_role correctly distinguishes IT roles from non-IT roles
  3. Skills extraction is exhaustive (including skills mentioned inline,
     not just in a dedicated "Skills" section)
"""
import json
from services.resume_parser import parse_resume

SAMPLE_RESUME = """
Aditya Kumar
aditya@example.com | +91-9876543210

SKILLS
Python, pandas, scikit-learn, XGBoost

EDUCATION
B.E. Civil Engineering, PSG College of Technology, 2023-2027

WORK EXPERIENCE

Data Science Intern, SmartED & Embrizon Technologies
July 2024 - September 2024
Built regression and classification models using XGBoost. Performed EDA
and created visualizations with matplotlib and seaborn.

Software Engineer, FullStack Solutions Pvt Ltd
January 2025 - Present
Built REST APIs using FastAPI and deployed services using Docker and AWS.

Site Engineer, BuildRight Constructions
June 2023 - December 2023
Supervised on-site construction activities, managed material procurement,
used AutoCAD for structural drawings.

PROJECTS
Credit Card Fraud Detection - built with FastAPI, Streamlit, joblib,
deployed on Render. Used SMOTE for class imbalance and Git for version control.
"""

if __name__ == "__main__":
    result = parse_resume(SAMPLE_RESUME)
    print(json.dumps(result, indent=2))

    print("\n--- Checks ---")
    if "error" in result:
        print("FAILED: parsing returned an error:", result["error"])
    else:
        we = result.get("work_experience", [])
        interns = result.get("internships", [])

        we_companies = [j.get("company") for j in we]
        intern_companies = [j.get("company") for j in interns]

        print(f"work_experience companies: {we_companies}")
        print(f"internships companies: {intern_companies}")

        # Expect: SmartED in internships, NOT in work_experience
        print("SmartED correctly in internships:",
              "SmartED & Embrizon Technologies" in intern_companies)
        print("SmartED correctly excluded from work_experience:",
              "SmartED & Embrizon Technologies" not in we_companies)

        # Expect: FullStack Solutions in work_experience, is_technical_role=True
        fullstack = next((j for j in we if "FullStack" in (j.get("company") or "")), None)
        print("FullStack Solutions in work_experience:", fullstack is not None)
        if fullstack:
            print("FullStack Solutions marked technical:", fullstack.get("is_technical_role"))

        # Expect: BuildRight in work_experience, is_technical_role=False (civil site role)
        buildright = next((j for j in we if "BuildRight" in (j.get("company") or "")), None)
        print("BuildRight in work_experience:", buildright is not None)
        if buildright:
            print("BuildRight marked NON-technical:", buildright.get("is_technical_role") == False)

        # Expect: skills list includes inline-mentioned tools (Docker, AWS, SMOTE, Git, matplotlib)
        # not just the ones in the dedicated Skills section.
        skills = [s.lower() for s in result.get("skills", [])]
        for expected in ["docker", "aws", "smote", "git", "matplotlib", "fastapi"]:
            found = any(expected in s for s in skills)
            print(f"Skill '{expected}' captured (inline mention): {found}")
