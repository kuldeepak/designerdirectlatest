//This code only draft product display

export async function loader({ request }) {
  const { admin } = await authenticate.public.appProxy(request);

  if (!admin) return { success: false, error: "Not authenticated" };

  const searchQuery = "status:DRAFT";

  const query = `
    query getDraftProducts($search: String!) {
      products(first: 20, query: $search) {
        edges {
          node {
            id
            title
            status
            vendor
            descriptionHtml
            featuredImage { url }
            metafields(first: 10) {
              edges {
                node { namespace key value }
              }
            }
          }
        }
      }
    }
  `;

  const res = await admin.graphql(query, { variables: { search: searchQuery } });
  const json = await res.json();

  const products = json.data.products.edges.map(edge => {
    const node = edge.node;
    const metafields = {};
    node.metafields.edges.forEach(({ node: mf }) => {
      if (mf.namespace === "custom") metafields[mf.key] = mf.value;
    });

    return {
      id: node.id,
      title: node.title,
      description: node.descriptionHtml,
      image: node.featuredImage?.url,
      brand_name: metafields.brand_name || "",
      category: metafields.category || "",
      notes: metafields.notes || "",
    };
  });

  return { success: true, products };
}




















// All code one script working like craete edit and prduct create

import { authenticate } from "../shopify.server";

export async function action({ request }) {
  try {
    // =======================
    // AUTHENTICATE FIRST (before reading body)
    // =======================
    const { admin, session } = await authenticate.public.appProxy(request);

    if (!admin) {
      return { success: false, error: "App not installed for this shop" };
    }

    // =======================
    // NOW READ FORM DATA
    // =======================
    const formData = await request.formData();

    // BRAND METAOBJECT DATA
    const metaobjectId = formData.get("id");
    const brandId = formData.get("brand_id");
    const brandName = formData.get("brand_name");
    const bio = formData.get("bio");
    const category = formData.get("category");
    const phone = formData.get("phone");
    const email = formData.get("contact_email");

    const lookbookFile = formData.get("lookbook_file");
    const linesheetPdf = formData.get("linesheet_pdf");

    // PRODUCT DATA
    const title = formData.get("title");
    const price = formData.get("price");
    const imageFile = formData.get("image");

    const description = formData.get("description");
    const notes = formData.get("notes");
    const categoryField = formData.get("category");
    const brandDisplayName = formData.get("brand_display_name");

    console.log('*********** FORM DATA RECEIVED ***********');
    console.log('Brand ID:', brandId, 'Brand Name:', brandName, 'Email:', email);
    console.log('Metaobject ID:', metaobjectId);
    console.log('Product Title:', title, 'Price:', price);

    console.log("description:", description);
    console.log("notes:", notes);
    console.log("categoryField:", categoryField);
    console.log("brandDisplayName:", brandDisplayName);

    if (!brandName) {
      return { success: false, error: "Brand name is required" };
    }

    // =======================
    // GRAPHQL HELPER
    // =======================
    const shopifyGraphQL = async (query, variables) => {
      const res = await admin.graphql(query, { variables });
      const json = await res.json();
      if (json.errors?.length) {
        console.error("GraphQL Error:", json.errors);
        throw new Error(JSON.stringify(json.errors));
      }
      return json.data;
    };

    // =======================
    // 1. ENSURE BRAND METAOBJECT DEFINITION
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
      const exists = data.metaobjectDefinitions.nodes.some(d => d.type === "brand_configurator");
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
    // 2. FILE UPLOAD HELPERS
    // =======================
    const stagedUpload = async (file, resource = "FILE") => {
      const query = `
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { message }
          }
        }
      `;
      const data = await shopifyGraphQL(query, {
        input: [{
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size.toString(),
          resource,
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
      for (const param of target.parameters) s3Form.append(param.name, param.value);
      s3Form.append("file", file);
      const res = await fetch(target.url, { method: "POST", body: s3Form });
      if (!res.ok) throw new Error("S3 upload failed");
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
      const data = await shopifyGraphQL(query, { files: [{ originalSource: resourceUrl }] });
      if (data.fileCreate.userErrors.length) throw new Error(data.fileCreate.userErrors[0].message);
      return data.fileCreate.files[0].id;
    };

    // =======================
    // 3. UPLOAD BRAND FILES
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
    // 4. CREATE/UPDATE BRAND METAOBJECT
    // =======================
    let metaobjectResult = null;

    if (metaobjectId && metaobjectId.trim() !== "") {
      // UPDATE
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
          metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
            metaobject { id handle fields { key value } }
            userErrors { field message }
          }
        }
      `;
      const fullId = metaobjectId.startsWith("gid://")
        ? metaobjectId
        : `gid://shopify/Metaobject/${metaobjectId}`;

      const updateData = await shopifyGraphQL(updateMutation, { id: fullId, fields });
      if (updateData.metaobjectUpdate.userErrors.length) {
        throw new Error(updateData.metaobjectUpdate.userErrors[0].message);
      }
      metaobjectResult = { action: "update", metaobject: updateData.metaobjectUpdate.metaobject };

    } else {
      // CREATE
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
          metaobjectCreate(metaobject: { handle: $handle, type: $type, fields: $fields }) {
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
      metaobjectResult = {
        action: "create",
        metaobjectId: createData.metaobjectCreate.metaobject.id
      };
    }

    // =======================
    // 5. CREATE PRODUCT (IF title + price + brandId PROVIDED)
    // =======================
    let productResult = null;

    if (title && price && brandId) {
      const createProductMutation = `
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product { id title vendor tags status }
            userErrors { field message }
          }
        }
      `;
      const productData = await shopifyGraphQL(createProductMutation, {
        input: {
          title,
          descriptionHtml: description || "",
          vendor: brandName || "Unknown",
          tags: email ? [email] : [],
          status: "DRAFT"
        }
      });
      if (productData.productCreate.userErrors.length) {
        throw new Error(productData.productCreate.userErrors[0].message);
      }

      const productId = productData.productCreate.product.id;

      // CREATE VARIANT
      const createVariantMutation = `
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            productVariants { id price }
            userErrors { field message }
          }
        }
      `;
      await shopifyGraphQL(createVariantMutation, {
        productId,
        variants: [{ price: price.toString() }]
      });

      // UPLOAD IMAGE
      if (imageFile && imageFile.size > 0) {
        const target = await stagedUpload(imageFile, "PRODUCT_IMAGE");
        await uploadToS3(target, imageFile);
        const attachImageMutation = `
          mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              media { id alt }
              mediaUserErrors { field message }
            }
          }
        `;
        await shopifyGraphQL(attachImageMutation, {
          productId,
          media: [{
            originalSource: target.resourceUrl,
            mediaContentType: "IMAGE"
          }]
        });
      }

      // ADD BRAND METAFIELD
      const metafieldMutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id key value }
            userErrors { field message }
          }
        }
      `;
      const metafieldRes = await shopifyGraphQL(metafieldMutation, {
        metafields: [
          {
            ownerId: productId,
            namespace: "custom",
            key: "brand_name",
            value: String(brandDisplayName || "")
          },
          {
            ownerId: productId,
            namespace: "custom",
            key: "notes",
            value: String(notes || "")
          },
          {
            ownerId: productId,
            namespace: "custom",
            key: "category",
            value: String(categoryField || "")
          }
        ]
      });

      console.log("METAFIELD RESPONSE:", JSON.stringify(metafieldRes, null, 2));

      if (metafieldRes.metafieldsSet.userErrors.length) {
        console.error("❌ METAFIELD ERRORS:", metafieldRes.metafieldsSet.userErrors);
      }

      productResult = { productId };
    }

    return { success: true, metaobject: metaobjectResult, product: productResult };

  } catch (error) {
    console.error('*** ACTION ERROR ***', error);
    console.error('*** ERROR MESSAGE ***', error.message);
    console.error('*** ERROR STACK ***', error.stack);
    return { success: false, error: error.message || "Action failed" };
  }
}
