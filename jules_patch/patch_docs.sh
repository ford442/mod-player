<<<<<<< SEARCH
### 3. Shader Coupling
*   **Technical Debt:** The shaders are not pure assets; they are tightly coupled to the TypeScript host code. Changing a shader's uniform struct requires a matching change in `createUniformPayload`.

---
=======
### 3. Shader Coupling
*   **Technical Debt:** The shaders are not pure assets; they are tightly coupled to the TypeScript host code. Changing a shader's uniform struct requires a matching change in `createUniformPayload`.

### 4. GPU Buffer Size Mismatches
*   **Known Issue:** WebGPU buffer size mismatch occasionally causes a pipeline crash when switching between modules with different channel counts. Invariants have been added to prevent regressions.

---
>>>>>>> REPLACE
