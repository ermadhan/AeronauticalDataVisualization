@echo off
title AeroOps Aeronautical Data Visualization
echo ========================================================
echo  Launching AeroOps Aeronautical Data Platform
echo  Data Source: ..\ourairports-data (Relative Path)
echo  Local Server: http://localhost:8080/
echo ========================================================
python server.py 8080
pause
