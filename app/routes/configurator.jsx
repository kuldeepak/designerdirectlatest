import { authenticate } from "../shopify.server";

export async function action({ request }) {
  try {
    // =======================
    // 1. Read form data
    // =======================
    const formData = await request.formData();

    const metaobjectId = formData.get("id"); // ID for update
    const brandName = formData.get("brand_name");
    const bio = formData.get("bio");
    const category = formData.get("category");
    const phone = formData.get("phone");
    const email = formData.get("contact_email");

    const lookbookFile = formData.get("lookbook_file");
    const linesheetPdf = formData.get("linesheet_pdf");

    console.log('*****************STEP1*******************');
    console.log('Metaobject ID received:', metaobjectId);
    console.log('Phone:', phone);

    if (!brandName) {
      return { success: false, error: "Brand name is required" };
    }

    // =======================
    // 2. Authenticate via App Proxy
    // =======================
    const { admin, session } = await authenticate.public.appProxy(request);
    if (!admin || !session) {
      return {
        success: false,
        error:
          "App proxy request is authenticated, but no app session exists for this shop. Reinstall/re-auth the app.",
      };
    }

    // =======================
    // 3. Shopify GraphQL helper
    // =======================
    const shopifyGraphQL = async (query, variables) => {
      const res = await admin.graphql(query, { variables });
      const json = await res.json();
      console.log('******************GraphQL Response*******************');
      console.log(json);

      if (json.errors?.length) {
        console.error("GraphQL Error:", json.errors);
        throw new Error(JSON.stringify(json.errors));
      }
      return json.data;
    };

    // =======================
    // 4. Ensure metaobject definition exists
    // =======================
    const ensureMetaobjectDefinition = async () => {
      const checkQuery = `
        query {
          metaobjectDefinitions(first: 250) {
            nodes { type }
          }
        }
      `;

      const data = await shopifyGraphQL(checkQuery);
      const exists = data.metaobjectDefinitions.nodes.some(
        d => d.type === "brand_configurator"
      );

      if (exists) return;

      const createMutation = `
        mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
          metaobjectDefinitionCreate(definition: $definition) {
            userErrors { message }
          }
        }
      `;

      const definition = {
        name: "Brand Configurator",
        type: "brand_configurator",
        fieldDefinitions: [
          { name: "Brand Name", key: "brand_name", type: "single_line_text_field", required: true },
          { name: "Bio", key: "bio", type: "single_line_text_field" },
          { name: "Category", key: "category", type: "single_line_text_field" },
          { name: "Phone", key: "phone", type: "single_line_text_field" },
          { name: "Contact email", key: "contact_email", type: "single_line_text_field" },
          { name: "Lookbook File", key: "lookbook_file", type: "file_reference" },
          { name: "Linesheet PDF", key: "linesheet_pdf", type: "file_reference" }
        ]
      };

      const res = await shopifyGraphQL(createMutation, { definition });
      if (res.metaobjectDefinitionCreate.userErrors.length) {
        throw new Error("Metaobject definition creation failed");
      }
    };

    await ensureMetaobjectDefinition();

    // =======================
    // 5. File upload helpers
    // =======================
    const stagedUpload = async (file) => {
      const query = `
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
              url
              resourceUrl
              parameters { name value }
            }
            userErrors { message }
          }
        }
      `;

      const data = await shopifyGraphQL(query, {
        input: [{
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size.toString(),
          resource: "FILE",
          httpMethod: "POST"
        }]
      });

      if (data.stagedUploadsCreate.userErrors.length) {
        throw new Error(data.stagedUploadsCreate.userErrors[0].message);
      }

      return data.stagedUploadsCreate.stagedTargets[0];
    };

    const uploadToS3 = async (target, file) => {
      const s3Form = new FormData();

      for (const param of target.parameters) {
        s3Form.append(param.name, param.value);
      }

      s3Form.append("file", file);

      const res = await fetch(target.url, {
        method: "POST",
        body: s3Form
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("S3 ERROR RESPONSE:", text);
        throw new Error("S3 upload failed");
      }
    };

    const createShopifyFile = async (resourceUrl) => {
      const query = `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { id }
            userErrors { message }
          }
        }
      `;

      const data = await shopifyGraphQL(query, {
        files: [{ originalSource: resourceUrl }]
      });

      if (data.fileCreate.userErrors.length) {
        throw new Error(data.fileCreate.userErrors[0].message);
      }

      return data.fileCreate.files[0].id;
    };

    // =======================
    // 6. Upload files if provided
    // =======================
    let lookbookFileId = null;
    if (lookbookFile && lookbookFile.size > 0) {
      const target = await stagedUpload(lookbookFile);
      await uploadToS3(target, lookbookFile);
      lookbookFileId = await createShopifyFile(target.resourceUrl);
    }

    let linesheetFileId = null;
    if (linesheetPdf && linesheetPdf.size > 0) {
      const target = await stagedUpload(linesheetPdf);
      await uploadToS3(target, linesheetPdf);
      linesheetFileId = await createShopifyFile(target.resourceUrl);
    }

    // =======================
    // 7. UPDATE or CREATE metaobject
    // =======================
    if (metaobjectId && metaobjectId.trim() !== "") {
      // UPDATE EXISTING METAOBJECT
      console.log('*****************UPDATING METAOBJECT*******************');
      console.log('ID:', metaobjectId);

      const fields = [
        { key: "brand_name", value: brandName },
        { key: "bio", value: bio || "" },
        { key: "category", value: category || "" },
        { key: "phone", value: phone || "" },
        { key: "contact_email", value: email || "" }
      ];

      if (lookbookFileId) fields.push({ key: "lookbook_file", value: lookbookFileId });
      if (linesheetFileId) fields.push({ key: "linesheet_pdf", value: linesheetFileId });

      const updateMutation = `
        mutation UpdateMetaobject($id: ID!, $fields: [MetaobjectFieldInput!]!) {
          metaobjectUpdate(
            id: $id
            metaobject: { fields: $fields }
          ) {
            metaobject { id handle fields { key value } }
            userErrors { field message }
          }
        }
      `;

      const fullId = metaobjectId.startsWith('gid://')
        ? metaobjectId
        : `gid://shopify/Metaobject/${metaobjectId}`;

      console.log('Full GID:', fullId);

      const updateData = await shopifyGraphQL(updateMutation, {
        id: fullId,
        fields
      });

      if (updateData.metaobjectUpdate.userErrors.length) {
        console.error('Update errors:', updateData.metaobjectUpdate.userErrors);
        throw new Error(updateData.metaobjectUpdate.userErrors[0].message);
      }

      console.log('*****************UPDATE SUCCESSFUL*******************');
      return {
        success: true,
        action: "update",
        metaobject: updateData.metaobjectUpdate.metaobject
      };

    } else {
      // CREATE NEW METAOBJECT
      console.log('*****************CREATING NEW METAOBJECT*******************');

      const handle = `${brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

      const fields = [
        { key: "brand_name", value: brandName },
        { key: "bio", value: bio || "" },
        { key: "category", value: category || "" },
        { key: "phone", value: phone || "" },
        { key: "contact_email", value: email || "" }
      ];

      if (lookbookFileId) fields.push({ key: "lookbook_file", value: lookbookFileId });
      if (linesheetFileId) fields.push({ key: "linesheet_pdf", value: linesheetFileId });

      const createMutation = `
        mutation CreateMetaobject($handle: String!, $type: String!, $fields: [MetaobjectFieldInput!]!) {
          metaobjectCreate(
            metaobject: { handle: $handle, type: $type, fields: $fields }
          ) {
            metaobject { id }
            userErrors { message }
          }
        }
      `;

      const createData = await shopifyGraphQL(createMutation, {
        handle,
        type: "brand_configurator",
        fields
      });

      if (createData.metaobjectCreate.userErrors.length) {
        throw new Error(createData.metaobjectCreate.userErrors[0].message);
      }

      console.log('*****************CREATE SUCCESSFUL*******************');
      return {
        success: true,
        action: "create",
        metaobjectId: createData.metaobjectCreate.metaobject.id
      };
    }

  } catch (error) {
    console.error('*****************ERROR*******************');
    console.error(error);
    return { success: false, error: error.message };
  }
}
